// RoomStudio.tsx — the Deploy step's real publish switch (WS-R7).
//
// WS-R1 built /r/<slug> and WS-R3/R4/R5/R6 built everything a Room needs to be
// worth opening, but nothing on the creator's side ever wrote a `vy_room` row.
// This is that switch: create the Room, name its address, publish it once the
// gates hold, and read the three real numbers it earns.
//
// ── SITS ABOVE ChannelsStudio's WEB LINK CARD, ON PURPOSE ──────────────────
// A channel is an address on somebody ELSE's platform this product connects
// TO (Telegram, WhatsApp). A Room is the address ON this platform, and it is
// where every follower's remembered relationship actually lives — Vyakti
// Rooms v1's own product paragraph. It is the primary way anyone reaches this
// AI, so it reads first.
//
// ── THE BUTTON'S DISABLED STATE NAMES ITS REASON ────────────────────────────
// `context/rejected.md#a-step-is-never-silently-blocked`: a gray button with
// no adjacent reason is a dead end that reads as a bug. `roomState.blockers`
// is fetched on MOUNT, before any publish attempt, split into "waiting on
// you" and "waiting on us" — never a count, always a name, and never one that
// blames the owner for our own queue.
//
// ── NEVER "clone" ────────────────────────────────────────────────────────
// Every string on this screen says "AI" or "Room". A follower reading the
// copied link, or the creator reading this card, never sees the other word.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import type { StepId } from "./wizardModel";
import {
  readOwnedRoom,
  createOwnedRoom,
  renameOwnedRoom,
  publishOwnedRoom,
  pauseOwnedRoom,
  resumeOwnedRoom,
  setOwnedRoomFreeCap,
  setOwnedRoomPaidCeilings,
  setOwnedRoomDefaultLocale,
  setOwnedRoomBio,
  listOwnedRoom,
  unlistOwnedRoom,
  readOwnedRoomStats,
  roomLink,
  roomEmbedSnippet,
  storyCardLink,
  firstRoomBlocker,
  RoomPublishApiError,
  type OwnedRoom,
  type RoomBlocker,
  type RoomBlockers,
  type RoomStats,
} from "./roomPublishApi";
import {
  readOwnedRoomCohorts,
  RoomCohortsApiError,
  type RoomCohortReport,
  type RoomCohortVerdictLine,
} from "./roomCohortsApi";
import CheckinsCard from "./CheckinsCard";
import HandoffCard from "./HandoffCard";
import SuiteCard from "./SuiteCard";
import PayoutsCard from "./PayoutsCard";
import InviteCreatorCard from "./InviteCreatorCard";
import { roomSuite, type SuiteRoomStatus } from "./orgApi";
import {
  readRoomPayments,
  setRoomPriceInr,
  startCreatorTierSubscription,
  cancelCreatorTierSubscription,
  PaymentsApiError,
  type RoomPrice,
  type RoomRevenue,
  type CreatorTierStatus,
} from "./paymentsApi";
import {
  readPulse,
  setPulseTopics,
  PulseApiError,
  PULSE_MAX_LABELS,
  PULSE_LABEL_MAX_LEN,
  type PulseReport,
} from "./pulseApi";
import { markFunnelStep } from "./funnelApi";
import { useStudioLocale } from "./localeContext";
import { withCount, withLabel, STUDIO_LANGUAGE_LABELS, type StudioCopy } from "./copy";
import "./roomStudio.css";

/** Plain-words sentence for the verdict line - WS-R12's own card. Never a
 *  fabricated number: an unmeasurable verdict names what is missing (a
 *  cohort six weeks old) rather than guessing at a percentage. */
function cohortVerdictSentence(t: StudioCopy, v: RoomCohortVerdictLine): string {
  const c = t.roomStudio;
  if (v.verdict === "not_measurable_yet" || v.week6_return_share == null || !v.cohort_week) {
    return c.notMeasurableYetVerdict;
  }
  const pct = Math.round(v.week6_return_share * 100);
  const band =
    v.verdict === "below_25" ? c.belowGateBand : v.verdict === "above_40" ? c.aboveCategoryBand : c.betweenBand;
  return c.cohortVerdictSentence.split("{label}").join(v.cohort_week).split("{n}").join(String(pct)).split("{label2}").join(band);
}

function formatCohortDate(t: StudioCopy, iso: string | null): string {
  if (!iso) return t.roomStudio.soon;
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const FREE_CAP_PRESETS = [10, 20, 50, 100] as const;
// WS-R19: mirrors migration 081's own CHECKs (100-2000 messages, 0-3600
// voice seconds) - the bound the studio offers and the bound Postgres holds
// must be the same numbers or the field would lie about what "editable"
// means.
const PAID_MESSAGES_MIN = 100;
const PAID_MESSAGES_MAX = 2000;
const PAID_VOICE_SECONDS_MIN = 0;
const PAID_VOICE_SECONDS_MAX = 3600;
// The follower price band - migration 078's own CHECK, mirrored so a bad
// value reads as a disabled Save button rather than a round trip to find out.
const PRICE_MIN_INR = 299;
const PRICE_MAX_INR = 599;
const PRICE_PRESETS = [299, 399, 499, 599] as const;

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** Where each named blocker's fix actually lives. `runtime-gate` sits on
 *  THIS step; the other two are on Meet it, so their affordance navigates
 *  there before it scrolls. A blocker this build has no entry for still
 *  renders — its own `headline`/`next` text — it simply has nowhere to jump. */
const BLOCKER_STEP: Record<string, StepId> = {
  "runtime-gate": "deploy",
  "readiness-title": "meet",
  "teacher-sheet-studio": "meet",
};

function BlockerRow({
  blocker,
  cls,
  onJump,
  t,
}: {
  blocker: RoomBlocker;
  cls: "you" | "us";
  onJump: (anchor: string) => void;
  t: StudioCopy;
}) {
  const id = blocker.anchor.replace("#", "");
  const step = BLOCKER_STEP[id];
  return (
    <li className={`vy-room__blocker vy-room__blocker--${cls}`}>
      <span className="vy-room__blocker-badge">{cls === "you" ? t.classLabels.you : t.classLabels.us}</span>
      <div>
        <p>{blocker.headline}</p>
        <p className="field-note">{blocker.next}</p>
      </div>
      {id && (
        <button type="button" className="text-button" onPointerDown={() => onJump(blocker.anchor)}>
          {step === "meet" ? t.wizardRail.goThere : t.roomStudio.showMe}
        </button>
      )}
    </li>
  );
}

export default function RoomStudio({
  token,
  replicaId,
  onAuthError,
  onGoStep,
  onStatusChange,
  onRoomState,
}: {
  token: string;
  replicaId: string;
  onAuthError?: (
    error: ReplicaApiError | RoomPublishApiError | RoomCohortsApiError | PaymentsApiError | PulseApiError,
  ) => void;
  onGoStep: (next: StepId) => void;
  /** Fed up so the wizard rail's Deploy readiness can read it without a
   *  second fetch of the same endpoint. */
  onStatusChange?: (published: boolean) => void;
  /** WS-R31. The richer read `StudioShell`'s Share tab needs (draft / paused
   *  / published, the follower count, the first open blocker) and the plain
   *  boolean above does not carry. Additive: existing callers that only pass
   *  `onStatusChange` are unaffected. Fed the same `room`/`stats`/first
   *  blocker this component already holds in state, never a second fetch. */
  onRoomState?: (
    room: OwnedRoom | null,
    stats: RoomStats | null,
    blocker: { label: string; anchor: string; cls: "you" | "us" } | null,
  ) => void;
}) {
  const { t } = useStudioLocale();
  const c = t.roomStudio;
  const [room, setRoom] = useState<OwnedRoom | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<RoomBlockers | null>(null);
  const [stats, setStats] = useState<RoomStats | null>(null);
  const [cohortReport, setCohortReport] = useState<RoomCohortReport | null>(null);
  const [cohortError, setCohortError] = useState(false);
  const [price, setPrice] = useState<RoomPrice | null>(null);
  const [revenue, setRevenue] = useState<RoomRevenue | null>(null);
  const [creatorTier, setCreatorTier] = useState<CreatorTierStatus | null>(null);
  const [pulse, setPulse] = useState<PulseReport | null>(null);
  const [pulseError, setPulseError] = useState(false);
  const [suiteStatus, setSuiteStatus] = useState<SuiteRoomStatus | null>(null);
  const [topicDraft, setTopicDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"create" | "slug" | "publish" | "pause" | "cap" | "price" | "topics" | "paid_ceilings" | "locale" | "creator_tier" | "bio" | "listed" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [slugDraft, setSlugDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  const [capDraft, setCapDraft] = useState(20);
  const [priceDraft, setPriceDraft] = useState(PRICE_MIN_INR);
  const [paidMessagesDraft, setPaidMessagesDraft] = useState(500);
  const [paidVoiceDraft, setPaidVoiceDraft] = useState(1800);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const embedCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fail = useCallback(
    (e: unknown) => {
      if (
        (e instanceof ReplicaApiError || e instanceof RoomPublishApiError || e instanceof PaymentsApiError ||
          e instanceof PulseApiError) &&
        (e.status === 401 || e.status === 403)
      ) {
        onAuthError?.(e);
        return;
      }
      if (e instanceof RoomPublishApiError && e.blockers) {
        setBlockers(e.blockers);
      }
      setError(e instanceof Error ? e.message.replaceAll("_", " ") : "request failed");
    },
    [onAuthError],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const state = await readOwnedRoom(token, replicaId);
      setRoom(state?.room ?? null);
      setReason(state?.reason ?? null);
      setBlockers(state?.blockers ?? null);
      setSlugDraft(state?.room?.slug ?? "");
      setBioDraft(state?.room?.one_line_bio ?? "");
      setCapDraft(state?.room?.free_monthly_messages ?? 20);
      setPaidMessagesDraft(state?.room?.paid_monthly_messages ?? 500);
      setPaidVoiceDraft(state?.room?.paid_monthly_voice_seconds ?? 1800);
      setError("");
      onStatusChange?.(Boolean(state?.room?.published));
      let loadedStats: RoomStats | null = null;
      if (state?.room) {
        loadedStats = await readOwnedRoomStats(token, replicaId).catch(() => null);
        setStats(loadedStats);
        try {
          setCohortReport(await readOwnedRoomCohorts(token, replicaId));
          setCohortError(false);
        } catch (e) {
          if (e instanceof RoomCohortsApiError && (e.status === 401 || e.status === 403)) {
            onAuthError?.(e);
          } else {
            setCohortError(true);
          }
        }
        const payments = await readRoomPayments(token, replicaId).catch(() => null);
        setPrice(payments?.price ?? null);
        setRevenue(payments?.revenue ?? null);
        setCreatorTier(payments?.creator_tier ?? null);
        setPriceDraft(payments?.price?.follower_price_inr ?? PRICE_MIN_INR);
        // WS-R28. Which Suite (if any) this Room belongs to - a card that
        // cannot see this still lets the creator publish and run their Room,
        // so a failed read degrades to "no Suite" rather than blocking load.
        setSuiteStatus(await roomSuite(token, replicaId).catch(() => null));
        try {
          setPulse(await readPulse(token, replicaId));
          setPulseError(false);
        } catch (e) {
          if (e instanceof PulseApiError && (e.status === 401 || e.status === 403)) {
            onAuthError?.(e);
          } else {
            setPulseError(true);
          }
        }
      }
      onRoomState?.(state?.room ?? null, loadedStats, firstRoomBlocker(state?.blockers ?? null));
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }, [token, replicaId, fail, onAuthError, onStatusChange, onRoomState]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replicaId]);

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    if (embedCopiedTimer.current) clearTimeout(embedCopiedTimer.current);
  }, []);

  const jumpTo = useCallback(
    (anchor: string) => {
      const id = anchor.replace("#", "");
      const step = BLOCKER_STEP[id];
      if (step && step !== "deploy") {
        onGoStep(step);
        window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
        return;
      }
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [onGoStep],
  );

  const create = useCallback(async () => {
    setBusy("create");
    setError("");
    try {
      const next = await createOwnedRoom(token, replicaId);
      setRoom(next);
      setReason(null);
      setSlugDraft(next.slug);
      setBioDraft(next.one_line_bio);
      setCapDraft(next.free_monthly_messages);
      setPaidMessagesDraft(next.paid_monthly_messages);
      setPaidVoiceDraft(next.paid_monthly_voice_seconds);
      setNotice(c.noticeRoomSetup);
      onStatusChange?.(next.published);
      onRoomState?.(next, null, null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, [token, replicaId, fail, onStatusChange, onRoomState]);

  const saveSlug = useCallback(async () => {
    setBusy("slug");
    setError("");
    setNotice("");
    try {
      const next = await renameOwnedRoom(token, replicaId, slugDraft);
      setRoom(next);
      setSlugDraft(next.slug);
      setNotice(c.noticeAddressSaved);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, [token, replicaId, slugDraft, fail]);

  const publish = useCallback(async () => {
    setBusy("publish");
    setError("");
    setNotice("");
    // WS-R25 (migration 088). The click site, distinct from the write below
    // succeeding: `publishOwnedRoom` can still refuse on the readiness lock,
    // and this mark is meant to record the attempt either way. Fire and
    // forget - a failed mark must never block or surface an error on the
    // actual publish flow.
    void markFunnelStep(token, replicaId, "publish_clicked").catch(() => {});
    try {
      const next = await publishOwnedRoom(token, replicaId);
      setRoom(next);
      setBlockers({ waiting_on_you: [], waiting_on_us: [] });
      setNotice(c.noticeRoomLive);
      onStatusChange?.(next.published);
      const freshStats = await readOwnedRoomStats(token, replicaId).catch(() => null);
      setStats(freshStats);
      setCohortReport(await readOwnedRoomCohorts(token, replicaId).catch(() => null));
      onRoomState?.(next, freshStats, null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, [token, replicaId, fail, onStatusChange, onRoomState]);

  const togglePause = useCallback(async () => {
    if (!room) return;
    setBusy("pause");
    setError("");
    setNotice("");
    try {
      const next = room.paused ? await resumeOwnedRoom(token, replicaId) : await pauseOwnedRoom(token, replicaId);
      setRoom(next);
      setNotice(next.paused ? c.pausedNotice : c.noticeResumed);
      onStatusChange?.(next.published);
      onRoomState?.(next, stats, null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, [token, replicaId, room, fail, onStatusChange, onRoomState, stats]);

  const saveCap = useCallback(
    async (next: number) => {
      setBusy("cap");
      setError("");
      try {
        const updated = await setOwnedRoomFreeCap(token, replicaId, next);
        setRoom(updated);
        setCapDraft(updated.free_monthly_messages);
        setNotice(withCount(c.noticeFreeCap, updated.free_monthly_messages));
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [token, replicaId, fail],
  );

  const saveDefaultLocale = useCallback(
    async (next: "en" | "hi") => {
      setBusy("locale");
      setError("");
      try {
        const updated = await setOwnedRoomDefaultLocale(token, replicaId, next);
        setRoom(updated);
        setNotice(next === "hi" ? c.noticeDefaultLocaleHi : c.noticeDefaultLocaleEn);
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [token, replicaId, fail],
  );

  const saveBio = useCallback(
    async (next: string) => {
      setBusy("bio");
      setError("");
      try {
        const updated = await setOwnedRoomBio(token, replicaId, next);
        setRoom(updated);
        setBioDraft(updated.one_line_bio);
        setNotice(c.noticeBioSaved);
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [token, replicaId, fail],
  );

  const toggleListed = useCallback(async () => {
    if (!room) return;
    setBusy("listed");
    setError("");
    setNotice("");
    try {
      const next = room.listed ? await unlistOwnedRoom(token, replicaId) : await listOwnedRoom(token, replicaId);
      setRoom(next);
      setNotice(next.listed ? c.noticeListed : c.noticeUnlisted);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, [token, replicaId, room, fail]);

  const savePaidCeilings = useCallback(
    async (messages: number, voiceSeconds: number) => {
      setBusy("paid_ceilings");
      setError("");
      try {
        const updated = await setOwnedRoomPaidCeilings(token, replicaId, messages, voiceSeconds);
        setRoom(updated);
        setPaidMessagesDraft(updated.paid_monthly_messages);
        setPaidVoiceDraft(updated.paid_monthly_voice_seconds);
        setNotice(
          c.noticePaidCeilings
            .split("{n}")
            .join(String(updated.paid_monthly_messages))
            .split("{n2}")
            .join(String(Math.round(updated.paid_monthly_voice_seconds / 60))),
        );
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [token, replicaId, fail],
  );

  const savePrice = useCallback(
    async (next: number) => {
      setBusy("price");
      setError("");
      try {
        const updated = await setRoomPriceInr(token, replicaId, next);
        setPrice(updated);
        setPriceDraft(updated.follower_price_inr);
        setNotice(withLabel(c.noticePrice, inr(updated.follower_price_inr)));
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [token, replicaId, fail],
  );

  const startTier = useCallback(
    async (plan: "room" | "studio") => {
      setBusy("creator_tier");
      setError("");
      try {
        const subscription = await startCreatorTierSubscription(token, replicaId, plan);
        setCreatorTier((prev) => (prev ? { ...prev, tier: subscription?.state === "active" ? plan : prev.tier, subscription } : prev));
        setNotice(c.noticeTierStarted);
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [token, replicaId, fail],
  );

  // WS-R37: cancel at period end - never immediately, api/_renewals.js's own
  // law. The subscription keeps working until `current_period_end`; only
  // `cancel_at_period_end` changes.
  const cancelTier = useCallback(async () => {
    setBusy("creator_tier");
    setError("");
    try {
      const subscription = await cancelCreatorTierSubscription(token, replicaId);
      setCreatorTier((prev) => (prev ? { ...prev, subscription } : prev));
      setNotice(c.noticeTierCancel);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, [token, replicaId, fail]);

  const saveTopics = useCallback(
    async (next: string[]) => {
      setBusy("topics");
      setError("");
      try {
        const topics = await setPulseTopics(token, replicaId, next);
        setPulse((prev) => (prev ? { ...prev, topics } : prev));
        setTopicDraft("");
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [token, replicaId, fail],
  );

  const addTopic = useCallback(() => {
    const label = topicDraft.trim();
    if (!label) return;
    const current = (pulse?.topics ?? []).map((t) => t.label);
    if (current.some((l) => l.toLowerCase() === label.toLowerCase())) {
      setTopicDraft("");
      return;
    }
    void saveTopics([...current, label]);
  }, [topicDraft, pulse, saveTopics]);

  const removeTopic = useCallback(
    (label: string) => {
      const current = (pulse?.topics ?? []).map((t) => t.label).filter((l) => l !== label);
      void saveTopics(current);
    },
    [pulse, saveTopics],
  );

  const copyLink = useCallback(() => {
    if (!room) return;
    void navigator.clipboard?.writeText(roomLink(room.slug)).then(
      () => {
        setCopied(true);
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 2400);
      },
      () => setCopied(false),
    );
  }, [room]);

  const embedSnippet = useMemo(() => (room ? roomEmbedSnippet(room.slug) : ""), [room]);

  const copyEmbed = useCallback(() => {
    if (!embedSnippet) return;
    void navigator.clipboard?.writeText(embedSnippet).then(
      () => {
        setEmbedCopied(true);
        if (embedCopiedTimer.current) clearTimeout(embedCopiedTimer.current);
        embedCopiedTimer.current = setTimeout(() => setEmbedCopied(false), 2400);
      },
      () => setEmbedCopied(false),
    );
  }, [embedSnippet]);

  const slugPreview = useMemo(
    () => slugDraft.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    [slugDraft],
  );
  const slugValid = slugPreview.length >= 3 && slugPreview.length <= 40;
  const slugChanged = room ? slugPreview !== room.slug : false;

  const canPublish = blockers ? blockers.waiting_on_you.length === 0 && blockers.waiting_on_us.length === 0 : false;

  if (loading) {
    return (
      <section id="room-studio" className="stage-section vy-room" aria-labelledby="room-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{c.eyebrow}</p>
            <h2 id="room-title">{c.loadingTitle}</h2>
          </div>
        </div>
        <p className="field-note" role="status">{c.checkingExists}</p>
      </section>
    );
  }

  if (!room) {
    return (
      <section id="room-studio" className="stage-section vy-room" aria-labelledby="room-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{c.eyebrow}</p>
            <h2 id="room-title">{c.setupTitle}</h2>
            <p>{c.setupIntro}</p>
          </div>
        </div>
        {/* Shown whenever there is no room yet, whatever the reason said (it
            reads null before the endpoint has ever answered). `createRoom`
            is idempotent on its own, so offering the button early is always
            safe: worst case it hands back the room that already existed. */}
        <button className="button primary-button" type="button" disabled={busy === "create"} onPointerDown={() => void create()}>
          {busy === "create" ? c.settingUp : c.setupButton}
        </button>
        {reason && reason !== "not_created" && <p className="field-note">{reason.replaceAll("_", " ")}</p>}
        {error && <p className="inline-error" role="alert">{error}</p>}
      </section>
    );
  }

  return (
    <section id="room-studio" className="stage-section vy-room" aria-labelledby="room-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{c.eyebrow}</p>
          <h2 id="room-title">{c.liveTitle}</h2>
          <p>{c.liveIntro}</p>
        </div>
        <span className={`vy-room__status vy-room__status--${room.published ? (room.paused ? "paused" : "live") : "draft"}`}>
          {room.published ? (room.paused ? c.statusPaused : c.statusLive) : c.statusDraft}
        </span>
      </div>

      <article className="teacher-sheet-card vy-room__link-card">
        <h3>{c.addressCardTitle}</h3>
        <div className="vy-room__link-row">
          <code className="vy-room__link">{roomLink(room.slug)}</code>
          <button className="button secondary-button" type="button" onPointerDown={copyLink}>
            {copied ? c.copied : c.copyLink}
          </button>
        </div>
        {/* WS-R55. The story card: the same public row this Room's own link
            already carries, drawn as a picture sized for Instagram/WhatsApp
            Status. Opens in a new tab so a creator can save it from there -
            this is a plain same-origin image link, never a download this
            page tries to trigger itself. */}
        <a
          className="button secondary-button vy-room__story-card-link"
          href={storyCardLink(room.slug)}
          target="_blank"
          rel="noreferrer"
        >
          {c.downloadStoryCard}
        </a>
        {suiteStatus && (
          <p className="field-note vy-room__suite-note">{withLabel(c.partOf, suiteStatus.name)}</p>
        )}
        {creatorTier && (
          creatorTier.tier === "covered_by_suite" ? (
            <p className="field-note vy-room__suite-note">
              {withLabel(c.suiteCoversRoom, suiteStatus?.name ?? c.yourSuite)}
            </p>
          ) : creatorTier.tier === "free" ? (
            <div className="vy-room__cap-row" role="group" aria-label={c.tierGroupAriaLabel}>
              <span className="field-note">{c.tierFreeLabel}</span>
              <button
                className="button secondary-button"
                type="button"
                disabled={busy === "creator_tier"}
                onPointerDown={() => void startTier("room")}
              >
                {busy === "creator_tier" ? c.working : withLabel(c.upgradeToRoom, inr(4999))}
              </button>
              <button
                className="button secondary-button"
                type="button"
                disabled={busy === "creator_tier"}
                onPointerDown={() => void startTier("studio")}
              >
                {busy === "creator_tier" ? c.working : withLabel(c.upgradeToStudio, inr(19999))}
              </button>
            </div>
          ) : (
            // `creatorTier.tier` only ever names a plan ("room"/"studio")
            // when the subscription behind it is 'active' -
            // api/_creator-tier.js's own `creatorTierFromRows` returns
            // "free" for every other state, so this line never needs to
            // qualify itself with a pending or lapsed state.
            <div className="vy-room__cap-row" role="group" aria-label={c.tierGroupAriaLabel}>
              <span className="field-note">
                {withLabel(c.tierLabel, creatorTier.tier === "room" ? c.tierRoom : c.tierStudio)}
                {/* WS-R37: the reminder line, one stated fact, no urgency. */}
                {creatorTier.subscription?.current_period_end &&
                  withLabel(
                    creatorTier.subscription.cancel_at_period_end ? c.willNotRenewOn : c.renewsOn,
                    new Date(creatorTier.subscription.current_period_end).toLocaleDateString(),
                  )}
              </span>
              {creatorTier.subscription && !creatorTier.subscription.cancel_at_period_end && (
                <button
                  className="button secondary-button"
                  type="button"
                  disabled={busy === "creator_tier"}
                  onPointerDown={() => void cancelTier()}
                >
                  {busy === "creator_tier" ? c.working : c.cancel}
                </button>
              )}
            </div>
          )
        )}

        <label className="field-label" htmlFor="room-slug">{c.changeAddressLabel}</label>
        <div className="vy-room__slug-row">
          <input
            id="room-slug"
            className="field"
            value={slugDraft}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setSlugDraft(event.target.value)}
          />
          <button
            className="button secondary-button"
            type="button"
            disabled={busy === "slug" || !slugValid || !slugChanged}
            onPointerDown={() => void saveSlug()}
          >
            {busy === "slug" ? c.saving : c.saveAddress}
          </button>
        </div>
        <p className="field-note">
          {slugDraft.trim() === ""
            ? c.enterAddress
            : !slugValid
              ? c.addressInvalid
              : withLabel(c.willReadAs, roomLink(slugPreview))}
        </p>
      </article>

      <article className="teacher-sheet-card vy-room__link-card">
        <h3>{c.telegramCardTitle}</h3>
        {room.telegram_deep_link ? (
          <div className="vy-room__link-row">
            <code className="vy-room__link">{room.telegram_deep_link}</code>
            <a className="button secondary-button" href={room.telegram_deep_link} target="_blank" rel="noreferrer">
              {c.open}
            </a>
          </div>
        ) : (
          <p className="field-note">{c.telegramNotConnected}</p>
        )}
      </article>

      <article className="teacher-sheet-card vy-room__link-card">
        <h3>{c.ownSiteCardTitle}</h3>
        <p className="field-note">{c.ownSiteIntro}</p>
        <pre className="embed-snippet" aria-label={c.embedSnippetAriaLabel}><code>{embedSnippet}</code></pre>
        <button className="button secondary-button" type="button" onPointerDown={copyEmbed}>
          {embedCopied ? c.copied : c.copySnippet}
        </button>
        <p className="field-note">{c.ownSiteFooter}</p>
      </article>

      <article className="teacher-sheet-card vy-room__publish-card">
        <h3>{room.published ? c.publishCardTitlePublished : c.publishCardTitleUnpublished}</h3>
        {!room.published && (
          <button className="button primary-button" type="button" disabled={busy === "publish"} onPointerDown={() => void publish()}>
            {busy === "publish" ? c.publishing : c.publishButton}
          </button>
        )}
        {room.published && (
          <button className="button secondary-button" type="button" disabled={busy === "pause"} onPointerDown={() => void togglePause()}>
            {busy === "pause" ? c.working : room.paused ? c.resume : c.pause}
          </button>
        )}

        {!canPublish && blockers && (blockers.waiting_on_you.length > 0 || blockers.waiting_on_us.length > 0) && (
          <ul className="vy-room__blockers">
            {blockers.waiting_on_you.map((b) => <BlockerRow key={b.code} blocker={b} cls="you" onJump={jumpTo} t={t} />)}
            {blockers.waiting_on_us.map((b) => <BlockerRow key={b.code} blocker={b} cls="us" onJump={jumpTo} t={t} />)}
          </ul>
        )}
        {room.published && !room.paused && (
          <p className="field-note">
            {withLabel(c.liveSince, room.published_at ? new Date(room.published_at).toLocaleDateString() : c.recently)}
          </p>
        )}
        {room.paused && (
          <p className="field-note">{c.pausedNotice}</p>
        )}
      </article>

      <article className="teacher-sheet-card vy-room__cap-card">
        <h3>{c.listMyRoomTitle}</h3>
        <p className="field-note">{c.listMyRoomIntro}</p>
        <label className="field-label" htmlFor="room-bio">{c.oneLineDescriptionLabel}</label>
        <div className="vy-room__slug-row">
          <input
            id="room-bio"
            className="field"
            value={bioDraft}
            maxLength={140}
            placeholder={c.oneLineDescriptionPlaceholder}
            onChange={(event) => setBioDraft(event.target.value)}
          />
          <button
            className="button secondary-button"
            type="button"
            disabled={busy === "bio" || bioDraft === room.one_line_bio}
            onPointerDown={() => void saveBio(bioDraft)}
          >
            {busy === "bio" ? c.saving : c.save}
          </button>
        </div>
        <p className="field-note">
          {room.published
            ? (room.listed ? c.listedNote : c.notListedNote)
            : c.publishFirstNote}
        </p>
        <button
          className="button secondary-button"
          type="button"
          disabled={busy === "listed" || !room.published}
          onPointerDown={() => void toggleListed()}
        >
          {busy === "listed" ? c.working : room.listed ? c.removeFromDirectory : c.listMyRoom}
        </button>
      </article>

      <article className="teacher-sheet-card vy-room__cap-card">
        <h3>{c.freeFollowersTitle}</h3>
        <p className="field-note">{c.freeFollowersIntro}</p>
        <div className="vy-room__cap-row" role="group" aria-label={c.freeMonthlyMessagesAriaLabel}>
          {FREE_CAP_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`vy-room__cap-pill${room.free_monthly_messages === preset ? " vy-room__cap-pill--selected" : ""}`}
              disabled={busy === "cap"}
              onPointerDown={() => { setCapDraft(preset); void saveCap(preset); }}
            >
              {preset}
            </button>
          ))}
          <input
            className="field vy-room__cap-field"
            type="number"
            min={0}
            max={100000}
            value={capDraft}
            onChange={(event) => setCapDraft(Number(event.target.value))}
          />
          <button
            className="button secondary-button"
            type="button"
            disabled={busy === "cap" || capDraft === room.free_monthly_messages || !Number.isFinite(capDraft)}
            onPointerDown={() => void saveCap(capDraft)}
          >
            {busy === "cap" ? c.saving : c.save}
          </button>
        </div>
      </article>

      <article className="teacher-sheet-card vy-room__cap-card">
        <h3>{c.roomLanguageTitle}</h3>
        <p className="field-note">{c.roomLanguageIntro}</p>
        <div className="vy-room__cap-row" role="group" aria-label={c.defaultRoomLanguageAriaLabel}>
          {(["en", "hi"] as const).map((loc) => (
            <button
              key={loc}
              type="button"
              className={`vy-room__cap-pill${room.default_locale === loc ? " vy-room__cap-pill--selected" : ""}`}
              disabled={busy === "locale"}
              onPointerDown={() => void saveDefaultLocale(loc)}
            >
              {STUDIO_LANGUAGE_LABELS[loc]}
            </button>
          ))}
        </div>
      </article>

      <article className="teacher-sheet-card vy-room__cap-card">
        <h3>{c.paidFollowersTitle}</h3>
        <p className="field-note">
          {c.paidFollowersIntroPre} {" "}
          <code>ROOM_VOICE</code> {c.paidFollowersIntroPost}
        </p>
        <label className="field-label" htmlFor="room-paid-messages">{c.messagesAMonthLabel}</label>
        <div className="vy-room__cap-row" role="group" aria-label={c.paidMonthlyMessagesAriaLabel}>
          <input
            id="room-paid-messages"
            className="field vy-room__cap-field"
            type="number"
            min={PAID_MESSAGES_MIN}
            max={PAID_MESSAGES_MAX}
            value={paidMessagesDraft}
            onChange={(event) => setPaidMessagesDraft(Number(event.target.value))}
          />
          <span className="field-note">{PAID_MESSAGES_MIN}-{PAID_MESSAGES_MAX}</span>
        </div>
        <label className="field-label" htmlFor="room-paid-voice">{c.voiceMinutesAMonthLabel}</label>
        <div className="vy-room__cap-row" role="group" aria-label={c.paidMonthlyVoiceMinutesAriaLabel}>
          <input
            id="room-paid-voice"
            className="field vy-room__cap-field"
            type="number"
            min={Math.ceil(PAID_VOICE_SECONDS_MIN / 60)}
            max={Math.floor(PAID_VOICE_SECONDS_MAX / 60)}
            value={Math.round(paidVoiceDraft / 60)}
            onChange={(event) => setPaidVoiceDraft(Math.round(Number(event.target.value)) * 60)}
          />
          <span className="field-note">
            0-{Math.floor(PAID_VOICE_SECONDS_MAX / 60)}
          </span>
          <button
            className="button secondary-button"
            type="button"
            disabled={
              busy === "paid_ceilings" ||
              !Number.isFinite(paidMessagesDraft) ||
              !Number.isFinite(paidVoiceDraft) ||
              (paidMessagesDraft === room.paid_monthly_messages && paidVoiceDraft === room.paid_monthly_voice_seconds)
            }
            onPointerDown={() => void savePaidCeilings(paidMessagesDraft, paidVoiceDraft)}
          >
            {busy === "paid_ceilings" ? c.saving : c.save}
          </button>
        </div>
      </article>

      <article className="teacher-sheet-card vy-room__price-card">
        <h3>{c.priceTitle}</h3>
        <p className="field-note">
          {c.priceIntro
            .split("{min}")
            .join(inr(PRICE_MIN_INR))
            .split("{max}")
            .join(inr(PRICE_MAX_INR))
            .split("{pct}")
            .join(String((price?.platform_take_bp ?? 2500) / 100))}
        </p>
        <div className="vy-room__cap-row" role="group" aria-label={c.followerPriceAriaLabel}>
          {PRICE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`vy-room__cap-pill${price?.follower_price_inr === preset ? " vy-room__cap-pill--selected" : ""}`}
              disabled={busy === "price"}
              onPointerDown={() => { setPriceDraft(preset); void savePrice(preset); }}
            >
              {inr(preset)}
            </button>
          ))}
          <input
            className="field vy-room__cap-field"
            type="number"
            min={PRICE_MIN_INR}
            max={PRICE_MAX_INR}
            value={priceDraft}
            onChange={(event) => setPriceDraft(Number(event.target.value))}
          />
          <button
            className="button secondary-button"
            type="button"
            disabled={
              busy === "price" ||
              priceDraft === price?.follower_price_inr ||
              !Number.isFinite(priceDraft) ||
              priceDraft < PRICE_MIN_INR ||
              priceDraft > PRICE_MAX_INR
            }
            onPointerDown={() => void savePrice(priceDraft)}
          >
            {busy === "price" ? c.saving : c.save}
          </button>
        </div>
        {!price && <p className="field-note">{c.noPriceYet}</p>}
      </article>

      <article className="teacher-sheet-card vy-room__money-card">
        <h3>{c.moneyTitle}</h3>
        {revenue && revenue.subscribers > 0 ? (
          <div className="vy-room__stats-grid">
            <div className="vy-room__stat">
              <span className="vy-room__stat-value">{revenue.subscribers}</span>
              <span className="vy-room__stat-label">{c.subscribers}</span>
            </div>
            <div className="vy-room__stat">
              <span className="vy-room__stat-value">{revenue.churned_this_month}</span>
              <span className="vy-room__stat-label">{c.leftThisMonth}</span>
            </div>
            <div className="vy-room__stat">
              <span className="vy-room__stat-value">{inr(revenue.creator_share_this_month_inr)}</span>
              <span className="vy-room__stat-label">{c.yourShareThisMonth}</span>
            </div>
          </div>
        ) : (
          <p className="field-note">{c.noSubscribersYet}</p>
        )}
        {revenue?.latest_payout ? (
          <p className="field-note">
            {c.lastPayout
              .split("{label}")
              .join(inr(revenue.latest_payout.net_inr))
              .split("{label2}")
              .join(t.payouts.stateLabel[revenue.latest_payout.state])
              .split("{label3}")
              .join(new Date(revenue.latest_payout.period_start).toLocaleDateString())
              .split("{label4}")
              .join(new Date(revenue.latest_payout.period_end).toLocaleDateString())}
          </p>
        ) : (
          <p className="field-note">{c.noPayoutYet}</p>
        )}
      </article>

      <article className="teacher-sheet-card vy-room__stats-card">
        <h3>{c.howDoingTitle}</h3>
        {stats ? (
          stats.followers_total === 0 ? (
            <p className="field-note">{c.noFollowersYet}</p>
          ) : (
            <div className="vy-room__stats-grid">
              <div className="vy-room__stat">
                <span className="vy-room__stat-value">{stats.followers_total}</span>
                <span className="vy-room__stat-label">{c.followers}</span>
              </div>
              <div className="vy-room__stat">
                <span className="vy-room__stat-value">{stats.followers_active_24h}</span>
                <span className="vy-room__stat-label">{c.activeToday}</span>
              </div>
              <div className="vy-room__stat">
                <span className="vy-room__stat-value">{stats.messages_this_month}</span>
                <span className="vy-room__stat-label">{c.messagesThisMonth}</span>
              </div>
            </div>
          )
        ) : (
          <p className="field-note">{c.couldNotLoadCounts}</p>
        )}
      </article>

      <article className="teacher-sheet-card vy-room__cohort-card">
        <h3>{c.weekSixTitle}</h3>
        <p className="field-note">{c.weekSixIntro}</p>
        {cohortReport ? (
          cohortReport.cohorts.length === 0 ? (
            <p className="field-note">{c.noCohortsYet}</p>
          ) : (
            <>
              <ul className="vy-room__cohort-list">
                {cohortReport.cohorts.map((cohort) => (
                  <li key={cohort.cohort_week} className="vy-room__cohort-row">
                    <span className="vy-room__cohort-week">{withLabel(c.weekOf, cohort.cohort_week)}</span>
                    {cohort.measurable ? (
                      <span className="vy-room__cohort-value">
                        {cohort.week6_return_share == null
                          ? c.noFollowersThatWeek
                          : withCount(c.stillTalkingPct, Math.round(cohort.week6_return_share * 100))}
                      </span>
                    ) : (
                      <span className="vy-room__cohort-value vy-room__cohort-value--pending">
                        {withLabel(c.notMeasurableUntil, formatCohortDate(t, cohort.not_measurable_until))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="field-note vy-room__cohort-verdict">{cohortVerdictSentence(t, cohortReport.verdict)}</p>
              <p className="field-note">{c.gateLine}</p>
            </>
          )
        ) : cohortError ? (
          <p className="field-note">{c.couldNotLoadRetry}</p>
        ) : (
          <p className="field-note" role="status">{c.loading}</p>
        )}
      </article>

      <SuiteCard
        token={token}
        roomId={room.room_id}
        roomOrgId={suiteStatus?.org_id ?? null}
        onRoomSuiteChange={(orgId) => {
          if (!orgId) {
            setSuiteStatus(null);
          } else {
            void roomSuite(token, replicaId).then(setSuiteStatus).catch(() => {});
          }
        }}
      />
      <CheckinsCard token={token} replicaId={replicaId} />
      <PayoutsCard token={token} />
      <InviteCreatorCard token={token} roomPublished={room.published} onAuthError={fail} />
      <HandoffCard token={token} replicaId={replicaId} />
      <article className="teacher-sheet-card vy-room__pulse-card">
        <h3>{c.pulseTitle}</h3>
        <p className="field-note">{c.pulseIntro}</p>
        <div className="vy-room__cap-row" role="group" aria-label={c.pulseTopicsAriaLabel}>
          {(pulse?.topics ?? []).map((topic) => (
            <span key={topic.topic_id} className="vy-room__cap-pill vy-room__cap-pill--selected">
              {topic.label}
              <button
                type="button"
                className="vy-room__pulse-topic-remove"
                aria-label={withLabel(c.removeTopicAriaLabel, topic.label)}
                disabled={busy === "topics"}
                onPointerDown={() => removeTopic(topic.label)}
              >
                &times;
              </button>
            </span>
          ))}
          {(pulse?.topics?.length ?? 0) < PULSE_MAX_LABELS && (
            <>
              <input
                className="field vy-room__cap-field"
                type="text"
                maxLength={PULSE_LABEL_MAX_LEN}
                placeholder={c.addTopicPlaceholder}
                value={topicDraft}
                onChange={(event) => setTopicDraft(event.target.value)}
              />
              <button
                className="button secondary-button"
                type="button"
                disabled={busy === "topics" || !topicDraft.trim()}
                onPointerDown={addTopic}
              >
                {busy === "topics" ? c.saving : c.add}
              </button>
            </>
          )}
        </div>
        {pulse ? (
          <>
            {pulse.status === "not_enough_optins" ? (
              <p className="field-note">{c.notEnoughOptins}</p>
            ) : (pulse.combo_buckets?.length ?? 0) > 0 ? (
              <div className="vy-room__stats-grid">
                {pulse.combo_buckets.map((b) => (
                  <div key={b.labels.join("+")} className="vy-room__stat">
                    <span className="vy-room__stat-value">{b.follower_count}</span>
                    <span className="vy-room__stat-label">{b.labels.join(" and ")}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="field-note">{c.enoughOptinsNoBucket}</p>
            )}
            {pulse.suppressed > 0 && (
              <p className="field-note">
                {withCount(pulse.suppressed === 1 ? c.suppressedOne : c.suppressedMany, pulse.suppressed)}
              </p>
            )}
            {pulse.note && <p className="field-note vy-room__pulse-note">{pulse.note}</p>}
          </>
        ) : pulseError ? (
          <p className="field-note">{c.couldNotLoadRetry}</p>
        ) : (
          <p className="field-note" role="status">{c.loading}</p>
        )}
      </article>

      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="field-note" role="status">{notice}</p>}
    </section>
  );
}
