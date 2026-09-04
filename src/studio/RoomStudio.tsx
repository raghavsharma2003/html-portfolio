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
  readOwnedRoomStats,
  roomLink,
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
import { roomSuite, type SuiteRoomStatus } from "./orgApi";
import {
  readRoomPayments,
  setRoomPriceInr,
  PaymentsApiError,
  type RoomPrice,
  type RoomRevenue,
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
import "./roomStudio.css";

/** Plain-words sentence for the verdict line - WS-R12's own card. Never a
 *  fabricated number: an unmeasurable verdict names what is missing (a
 *  cohort six weeks old) rather than guessing at a percentage. */
function cohortVerdictSentence(v: RoomCohortVerdictLine): string {
  if (v.verdict === "not_measurable_yet" || v.week6_return_share == null || !v.cohort_week) {
    return "Not measurable yet. This needs a cohort that has been open for at least six weeks.";
  }
  const pct = Math.round(v.week6_return_share * 100);
  const band =
    v.verdict === "below_25"
      ? "below the 25% gate this product needs to work at all"
      : v.verdict === "above_40"
        ? "above the 40% line where this becomes a category"
        : "between the 25% gate and the 40% category line";
  return `Your oldest measurable cohort, the week of ${v.cohort_week}, returned ${pct}%. That is ${band}.`;
}

function formatCohortDate(iso: string | null): string {
  if (!iso) return "soon";
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

function BlockerRow({ blocker, cls, onJump }: { blocker: RoomBlocker; cls: "you" | "us"; onJump: (anchor: string) => void }) {
  const id = blocker.anchor.replace("#", "");
  const step = BLOCKER_STEP[id];
  return (
    <li className={`vy-room__blocker vy-room__blocker--${cls}`}>
      <span className="vy-room__blocker-badge">{cls === "you" ? "Waiting on you" : "Waiting on us"}</span>
      <div>
        <p>{blocker.headline}</p>
        <p className="field-note">{blocker.next}</p>
      </div>
      {id && (
        <button type="button" className="text-button" onPointerDown={() => onJump(blocker.anchor)}>
          {step === "meet" ? "Go there" : "Show me"}
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
  const [room, setRoom] = useState<OwnedRoom | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<RoomBlockers | null>(null);
  const [stats, setStats] = useState<RoomStats | null>(null);
  const [cohortReport, setCohortReport] = useState<RoomCohortReport | null>(null);
  const [cohortError, setCohortError] = useState(false);
  const [price, setPrice] = useState<RoomPrice | null>(null);
  const [revenue, setRevenue] = useState<RoomRevenue | null>(null);
  const [pulse, setPulse] = useState<PulseReport | null>(null);
  const [pulseError, setPulseError] = useState(false);
  const [suiteStatus, setSuiteStatus] = useState<SuiteRoomStatus | null>(null);
  const [topicDraft, setTopicDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"create" | "slug" | "publish" | "pause" | "cap" | "price" | "topics" | "paid_ceilings" | "locale" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [slugDraft, setSlugDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [capDraft, setCapDraft] = useState(20);
  const [priceDraft, setPriceDraft] = useState(PRICE_MIN_INR);
  const [paidMessagesDraft, setPaidMessagesDraft] = useState(500);
  const [paidVoiceDraft, setPaidVoiceDraft] = useState(1800);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

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
      setCapDraft(next.free_monthly_messages);
      setPaidMessagesDraft(next.paid_monthly_messages);
      setPaidVoiceDraft(next.paid_monthly_voice_seconds);
      setNotice("Your Room is set up. Publish it when you are ready.");
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
      setNotice("Address saved.");
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
      setNotice("Your Room is live.");
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
      setNotice(next.paused ? "Paused. Nobody can reach your Room until you resume it." : "Resumed. Your Room is live again.");
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
        setNotice(`Free followers now get ${updated.free_monthly_messages} messages a month.`);
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
        setNotice(
          next === "hi"
            ? "New followers with no language set will see Hindi first."
            : "New followers with no language set will see English first.",
        );
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [token, replicaId, fail],
  );

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
          `Paid followers now get ${updated.paid_monthly_messages} messages and ` +
            `${Math.round(updated.paid_monthly_voice_seconds / 60)} voice minutes a month.`,
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
        setNotice(`Followers now pay ${inr(updated.follower_price_inr)} a month.`);
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [token, replicaId, fail],
  );

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
            <p className="eyebrow">Your Room</p>
            <h2 id="room-title">Loading your Room</h2>
          </div>
        </div>
        <p className="field-note" role="status">Checking whether your Room exists yet.</p>
      </section>
    );
  }

  if (!room) {
    return (
      <section id="room-studio" className="stage-section vy-room" aria-labelledby="room-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Your Room</p>
            <h2 id="room-title">Set up the place your AI lives</h2>
            <p>
              A Room is a private, continuing address for every follower who talks to your AI. It remembers each
              of them, on its own, and never shows one follower to another. Set it up once, then publish it when
              the gates below are clear.
            </p>
          </div>
        </div>
        {/* Shown whenever there is no room yet, whatever the reason said (it
            reads null before the endpoint has ever answered). `createRoom`
            is idempotent on its own, so offering the button early is always
            safe: worst case it hands back the room that already existed. */}
        <button className="button primary-button" type="button" disabled={busy === "create"} onPointerDown={() => void create()}>
          {busy === "create" ? "Setting up..." : "Set up your Room"}
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
          <p className="eyebrow">Your Room</p>
          <h2 id="room-title">The place your AI lives</h2>
          <p>
            One private, continuing address. Every follower who joins gets their own remembered relationship with
            your AI, and none of them ever sees another follower's conversation, or yours.
          </p>
        </div>
        <span className={`vy-room__status vy-room__status--${room.published ? (room.paused ? "paused" : "live") : "draft"}`}>
          {room.published ? (room.paused ? "Paused" : "Live") : "Not published"}
        </span>
      </div>

      <article className="teacher-sheet-card vy-room__link-card">
        <h3>Your Room's address</h3>
        <div className="vy-room__link-row">
          <code className="vy-room__link">{roomLink(room.slug)}</code>
          <button className="button secondary-button" type="button" onPointerDown={copyLink}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        {suiteStatus && (
          <p className="field-note vy-room__suite-note">Part of {suiteStatus.name}.</p>
        )}

        <label className="field-label" htmlFor="room-slug">Change the address</label>
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
            {busy === "slug" ? "Saving..." : "Save address"}
          </button>
        </div>
        <p className="field-note">
          {slugDraft.trim() === ""
            ? "Enter an address for your Room."
            : !slugValid
              ? "Between 3 and 40 letters, numbers, or dashes."
              : `Will read as ${roomLink(slugPreview)}`}
        </p>
      </article>

      <article className="teacher-sheet-card vy-room__link-card">
        <h3>Your Room on Telegram</h3>
        {room.telegram_deep_link ? (
          <div className="vy-room__link-row">
            <code className="vy-room__link">{room.telegram_deep_link}</code>
            <a className="button secondary-button" href={room.telegram_deep_link} target="_blank" rel="noreferrer">
              Open
            </a>
          </div>
        ) : (
          <p className="field-note">
            Not connected yet. Followers still reach your Room at the address above; Telegram is a second way in,
            not a requirement.
          </p>
        )}
      </article>

      <article className="teacher-sheet-card vy-room__publish-card">
        <h3>{room.published ? "Publishing" : "Publish your Room"}</h3>
        {!room.published && (
          <button className="button primary-button" type="button" disabled={busy === "publish"} onPointerDown={() => void publish()}>
            {busy === "publish" ? "Publishing..." : "Publish your Room"}
          </button>
        )}
        {room.published && (
          <button className="button secondary-button" type="button" disabled={busy === "pause"} onPointerDown={() => void togglePause()}>
            {busy === "pause" ? "Working..." : room.paused ? "Resume" : "Pause"}
          </button>
        )}

        {!canPublish && blockers && (blockers.waiting_on_you.length > 0 || blockers.waiting_on_us.length > 0) && (
          <ul className="vy-room__blockers">
            {blockers.waiting_on_you.map((b) => <BlockerRow key={b.code} blocker={b} cls="you" onJump={jumpTo} />)}
            {blockers.waiting_on_us.map((b) => <BlockerRow key={b.code} blocker={b} cls="us" onJump={jumpTo} />)}
          </ul>
        )}
        {room.published && !room.paused && (
          <p className="field-note">
            Live since {room.published_at ? new Date(room.published_at).toLocaleDateString() : "recently"}. Anyone
            with your Room's address can join and start their own remembered relationship with your AI.
          </p>
        )}
        {room.paused && (
          <p className="field-note">Paused. Nobody can reach your Room until you resume it.</p>
        )}
      </article>

      <article className="teacher-sheet-card vy-room__cap-card">
        <h3>Free followers</h3>
        <p className="field-note">
          A follower who has not paid gets this many messages a month, no voice, no check-ins. You can change it
          any time.
        </p>
        <div className="vy-room__cap-row" role="group" aria-label="Free monthly messages">
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
            {busy === "cap" ? "Saving..." : "Save"}
          </button>
        </div>
      </article>

      <article className="teacher-sheet-card vy-room__cap-card">
        <h3>Room language</h3>
        <p className="field-note">
          Your AI keeps speaking whatever you speak with it - this only picks the app's own screens: the buttons,
          the disclosure line, the menu. A follower who has joined before, or whose own browser reports a
          language, sees that instead; this is only the first screen for everyone else.
        </p>
        <div className="vy-room__cap-row" role="group" aria-label="Default room language">
          {(["en", "hi"] as const).map((loc) => (
            <button
              key={loc}
              type="button"
              className={`vy-room__cap-pill${room.default_locale === loc ? " vy-room__cap-pill--selected" : ""}`}
              disabled={busy === "locale"}
              onPointerDown={() => void saveDefaultLocale(loc)}
            >
              {loc === "hi" ? "हिन्दी" : "English"}
            </button>
          ))}
        </div>
      </article>

      <article className="teacher-sheet-card vy-room__cap-card">
        <h3>Paid followers</h3>
        <p className="field-note">
          Unlimited-feeling chat under a fair-use ceiling, plus voice replies when {" "}
          <code>ROOM_VOICE</code> is on. Both numbers are yours to set, within the plan's bounds.
        </p>
        <label className="field-label" htmlFor="room-paid-messages">Messages a month</label>
        <div className="vy-room__cap-row" role="group" aria-label="Paid monthly messages">
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
        <label className="field-label" htmlFor="room-paid-voice">Voice minutes a month</label>
        <div className="vy-room__cap-row" role="group" aria-label="Paid monthly voice minutes">
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
            {busy === "paid_ceilings" ? "Saving..." : "Save"}
          </button>
        </div>
      </article>

      <article className="teacher-sheet-card vy-room__price-card">
        <h3>Price</h3>
        <p className="field-note">
          What a follower pays a month for unlimited within fair use, past the free messages above. Between{" "}
          {inr(PRICE_MIN_INR)} and {inr(PRICE_MAX_INR)}. Vyakti keeps {(price?.platform_take_bp ?? 2500) / 100}% of
          what a follower pays; the rest is yours.
        </p>
        <div className="vy-room__cap-row" role="group" aria-label="Follower price">
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
            {busy === "price" ? "Saving..." : "Save"}
          </button>
        </div>
        {!price && <p className="field-note">No price set yet. Followers cannot subscribe until you set one.</p>}
      </article>

      <article className="teacher-sheet-card vy-room__money-card">
        <h3>Money</h3>
        {revenue && revenue.subscribers > 0 ? (
          <div className="vy-room__stats-grid">
            <div className="vy-room__stat">
              <span className="vy-room__stat-value">{revenue.subscribers}</span>
              <span className="vy-room__stat-label">Subscribers</span>
            </div>
            <div className="vy-room__stat">
              <span className="vy-room__stat-value">{revenue.churned_this_month}</span>
              <span className="vy-room__stat-label">Left this month</span>
            </div>
            <div className="vy-room__stat">
              <span className="vy-room__stat-value">{inr(revenue.creator_share_this_month_inr)}</span>
              <span className="vy-room__stat-label">Your share this month</span>
            </div>
          </div>
        ) : (
          <p className="field-note">No subscribers yet.</p>
        )}
        {revenue?.latest_payout ? (
          <p className="field-note">
            Last payout: {inr(revenue.latest_payout.net_inr)} ({revenue.latest_payout.state}), for{" "}
            {new Date(revenue.latest_payout.period_start).toLocaleDateString()} to{" "}
            {new Date(revenue.latest_payout.period_end).toLocaleDateString()}.
          </p>
        ) : (
          <p className="field-note">No payout yet.</p>
        )}
      </article>

      <article className="teacher-sheet-card vy-room__stats-card">
        <h3>How your Room is doing</h3>
        {stats ? (
          stats.followers_total === 0 ? (
            <p className="field-note">No followers yet. Share your Room's address to change that.</p>
          ) : (
            <div className="vy-room__stats-grid">
              <div className="vy-room__stat">
                <span className="vy-room__stat-value">{stats.followers_total}</span>
                <span className="vy-room__stat-label">Followers</span>
              </div>
              <div className="vy-room__stat">
                <span className="vy-room__stat-value">{stats.followers_active_24h}</span>
                <span className="vy-room__stat-label">Active today</span>
              </div>
              <div className="vy-room__stat">
                <span className="vy-room__stat-value">{stats.messages_this_month}</span>
                <span className="vy-room__stat-label">Messages this month</span>
              </div>
            </div>
          )
        ) : (
          <p className="field-note">Could not load your counts just now. They will show the next time this loads.</p>
        )}
      </article>

      <article className="teacher-sheet-card vy-room__cohort-card">
        <h3>Week six</h3>
        <p className="field-note">
          Of the followers who joined in a given week, the share still talking to your AI six weeks later.
          This is the number that matters most, more than messages sent or how many showed up today.
        </p>
        {cohortReport ? (
          cohortReport.cohorts.length === 0 ? (
            <p className="field-note">No cohorts yet. This fills in once your Room has its first followers.</p>
          ) : (
            <>
              <ul className="vy-room__cohort-list">
                {cohortReport.cohorts.map((c) => (
                  <li key={c.cohort_week} className="vy-room__cohort-row">
                    <span className="vy-room__cohort-week">Week of {c.cohort_week}</span>
                    {c.measurable ? (
                      <span className="vy-room__cohort-value">
                        {c.week6_return_share == null
                          ? "No followers that week"
                          : `${Math.round(c.week6_return_share * 100)}% still talking`}
                      </span>
                    ) : (
                      <span className="vy-room__cohort-value vy-room__cohort-value--pending">
                        Not measurable until {formatCohortDate(c.not_measurable_until)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="field-note vy-room__cohort-verdict">{cohortVerdictSentence(cohortReport.verdict)}</p>
              <p className="field-note">
                The gate is 25% or higher. 40% or higher is where this stops being a feature and becomes a category.
              </p>
            </>
          )
        ) : cohortError ? (
          <p className="field-note">Could not load this just now. It will show the next time this loads.</p>
        ) : (
          <p className="field-note" role="status">Loading.</p>
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
      <HandoffCard token={token} replicaId={replicaId} />
      <article className="teacher-sheet-card vy-room__pulse-card">
        <h3>Pulse</h3>
        <p className="field-note">
          What your followers are talking about, as counts only, and only from conversations a follower chose to let
          count. Never a message, never a name, and never shown until at least five different followers are behind a
          number.
        </p>
        <div className="vy-room__cap-row" role="group" aria-label="Pulse topics">
          {(pulse?.topics ?? []).map((t) => (
            <span key={t.topic_id} className="vy-room__cap-pill vy-room__cap-pill--selected">
              {t.label}
              <button
                type="button"
                className="vy-room__pulse-topic-remove"
                aria-label={`Remove topic ${t.label}`}
                disabled={busy === "topics"}
                onPointerDown={() => removeTopic(t.label)}
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
                placeholder="Add a topic, e.g. exam stress"
                value={topicDraft}
                onChange={(event) => setTopicDraft(event.target.value)}
              />
              <button
                className="button secondary-button"
                type="button"
                disabled={busy === "topics" || !topicDraft.trim()}
                onPointerDown={addTopic}
              >
                {busy === "topics" ? "Saving..." : "Add"}
              </button>
            </>
          )}
        </div>
        {pulse ? (
          <>
            {pulse.status === "not_enough_optins" ? (
              <p className="field-note">Not enough people have opted in yet.</p>
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
              <p className="field-note">
                Enough followers have opted in, but nothing has five behind it yet.
              </p>
            )}
            {pulse.suppressed > 0 && (
              <p className="field-note">
                {pulse.suppressed} combination{pulse.suppressed === 1 ? "" : "s"} were held back this week because
                showing them would have named someone.
              </p>
            )}
            {pulse.note && <p className="field-note vy-room__pulse-note">{pulse.note}</p>}
          </>
        ) : pulseError ? (
          <p className="field-note">Could not load this just now. It will show the next time this loads.</p>
        ) : (
          <p className="field-note" role="status">Loading.</p>
        )}
      </article>

      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="field-note" role="status">{notice}</p>}
    </section>
  );
}
