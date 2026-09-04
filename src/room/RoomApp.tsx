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
  type RoomCopy,
  type RoomLocale,
} from "./copy";
import CheckinsPanel from "./CheckinsPanel";
import HandoffPanel from "./HandoffPanel";
import {
  RoomApiError,
  exportRoomData,
  forgetRoomData,
  joinRoom,
  newRoomThread,
  openRoom,
  roomCitations,
  roomHistory,
  roomStats,
  revokePulseOptIn,
  sayInRoom,
  setPulseOptIn,
  setRoomLocale,
  speakInRoom,
  slugFromPath,
  type RoomCitations,
  type RoomFollower,
  type RoomForgetReceipt,
  type RoomOpen,
  type RoomQuota,
  type RoomThread,
} from "./roomApi";
import { RoomPayApiError, startSubscription } from "./roomPayApi";

type Turn = { role: "user" | "assistant"; content: string; fresh?: boolean };
type Phase = "loading" | "unavailable" | "join" | "talking" | "gone";

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
}

export default function RoomApp({ fixtureOpen, fixtureTurns }: Props) {
  const slug = useMemo(() => (fixtureOpen ? fixtureOpen.room.slug : slugFromPath()), [fixtureOpen]);
  const [phase, setPhase] = useState<Phase>(fixtureOpen ? (fixtureOpen.joined ? "talking" : "join") : "loading");
  const [room, setRoom] = useState<RoomOpen | null>(fixtureOpen ?? null);
  const [auth, setAuth] = useState<StudioSession | null>(null);
  const [session, setSession] = useState<string | null>(fixtureOpen?.session ?? null);
  const [turns, setTurns] = useState<Turn[]>(fixtureTurns ?? []);
  const [threads, setThreads] = useState<RoomThread[]>(fixtureOpen?.threads ?? []);
  const [thread, setThread] = useState<string | null>(null);
  const [quota, setQuota] = useState<RoomQuota | null>(null);
  const [upgrade, setUpgrade] = useState(false);
  const [capped, setCapped] = useState(false);
  const [talkedToday, setTalkedToday] = useState<number | null>(null);
  // WS-R27: the forget receipt, shown once on the "gone" screen and nowhere
  // else - there is nothing to look it up by later (law 3), so this is the
  // only copy this session will ever hold.
  const [forgetReceipt, setForgetReceipt] = useState<RoomForgetReceipt | null>(null);
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
  const [menu, setMenu] = useState(false);
  const [checkinsOpen, setCheckinsOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const foot = useRef<HTMLDivElement | null>(null);
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
  // WS-R20: no tier gate, by the workstream's own law - Handoff is the
  // creator's choice per Room, never money's. `room.handoff_enabled` is the
  // SAME column `sendHandoffRequest`'s predicate reads, never a client guess.
  const canHandoff = room?.room.handoff_enabled === true;
  // The tier this session actually knows right now: `quota` (set after the
  // first turn) if present, the join/open response otherwise. Both are real
  // server state - this line picks between two true answers, never guesses.
  const tier = quota?.tier ?? room?.follower?.tier ?? "free";

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
        const opened = await openRoom(slug, restored?.accessToken ?? null, hint);
        if (!live) return;
        setRoom(opened);
        setSession(opened.session);
        setThreads(opened.threads ?? []);
        setPhase(opened.joined ? "talking" : "join");
      } catch {
        if (live) setPhase("unavailable");
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
      if (fixtureOpen || localeBusy || next === locale) return;
      setLocaleBusy(true);
      try {
        if (session && phase === "talking") {
          const result = await setRoomLocale(session, next);
          setSession(result.session);
          setRoom((prev) => (prev ? { ...prev, locale: result.locale } : prev));
        } else {
          const opened = await openRoom(slug, auth?.accessToken ?? null, next);
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
    [fixtureOpen, localeBusy, locale, session, phase, slug, auth],
  );

  /* The one statistic, and only when it is real. A null renders nothing rather
   * than a zero that looks like a measurement. */
  useEffect(() => {
    if (fixtureOpen || phase === "loading" || phase === "unavailable") return;
    roomStats(slug)
      .then((s) => setTalkedToday(typeof s.talked_today === "number" ? s.talked_today : null))
      .catch(() => setTalkedToday(null));
  }, [slug, phase, fixtureOpen]);

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

  /* WS-R22: the installable Room. `public/room.webmanifest` (linked from
   * room.html) is ONE static file shared by every creator's Room — its own
   * `start_url` can only ever be a placeholder, because the Room is
   * multi-tenant and a manifest file has no way to know which `/r/<slug>` a
   * given browser tab is even on. So once THIS tab knows its own slug and
   * the creator's own PUBLIC name (`room.name`/`display_name` — never a
   * word this follower said), it swaps the manifest link to an in-memory
   * Blob URL carrying THIS room's `start_url` — the standard "dynamic web
   * app manifest" technique, no server route needed. A browser that installs
   * before this effect runs (or with JS disabled) still gets the static
   * fallback rather than nothing; this only makes "Add to Home Screen" land
   * back on the right creator instead of a generic, unrouted `/r/`. Never
   * runs for the layout fixture — it touches `document.head`, not this
   * component's own rendered DOM, and the gate has no `URL.createObjectURL`
   * expectation to keep honest either way. */
  useEffect(() => {
    if (fixtureOpen || !slug) return;
    let href = "";
    try {
      const manifest = {
        name: name ? `${name} AI` : "The Room",
        short_name: "Room",
        description: "A private, continuing conversation with a creator's AI.",
        start_url: `/r/${slug}`,
        display: "standalone",
        background_color: "#f4f1e9",
        theme_color: "#f4f1e9",
        icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
      };
      const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
      href = URL.createObjectURL(blob);
      let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "manifest";
        document.head.appendChild(link);
      }
      link.href = href;
    } catch {
      // Best effort only — a browser that cannot do this still has the
      // static room.webmanifest room.html already links.
    }
    return () => {
      if (href) URL.revokeObjectURL(href);
    };
  }, [slug, name, fixtureOpen]);

  useEffect(() => {
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
      } else if (cause instanceof RoomApiError && cause.code === "room_disclosure_stale") {
        setError(copy.errors.stale);
      } else if (cause instanceof RoomApiError && cause.code === "room_message_too_long") {
        setError(copy.errors.tooLong);
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
          setRoom(joined);
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
          <h1>{name ? `${name} AI` : room?.room.display_name}</h1>
          <div className="room-head-actions">
            <LanguageSwitch locale={locale} busy={localeBusy} onSwitch={switchLocale} />
            {canCheckin && (
              <button type="button" className="room-menu-open" onClick={() => setCheckinsOpen(true)}>
                {copy.checkins.title}
              </button>
            )}
            {canHandoff && (
              <button type="button" className="room-menu-open" onClick={() => setHandoffOpen(true)}>
                {withName(copy.handoff.title, name || room?.room.display_name || "")}
              </button>
            )}
            <button type="button" className="room-menu-open" onClick={() => setMenu(true)}>
              {copy.menu.title}
            </button>
          </div>
        </div>
        {/* ONE statistic, and only if a real count came back. */}
        {typeof talkedToday === "number" && talkedToday > 0 && (
          <p className="room-stat">
            {talkedToday === 1
              ? copy.stats.talkedTodayOne
              : withCount(copy.stats.talkedToday, talkedToday)}
          </p>
        )}
      </header>

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
          {(room?.disclosure || "").split("\n").map((line) => (
            <p key={line}>{line}</p>
          ))}
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

        {/* THE END OF A SESSION THAT WORKED. Under the last reply, never across
            one, and it states a fact rather than making one up. */}
        {upgrade && quota && quota.messages_left !== null && !capped && (
          <p className="room-upgrade">
            {quota.messages_left === 0
              ? copy.quota.lastOne
              : withIncluded(copy.quota.left, quota.messages_left, quota.messages_included)}
            {" "}
            <button type="button" className="room-btn" disabled={payBusy} onPointerDown={() => void subscribe()}>
              {payBusy ? copy.pay.working : copy.pay.cta}
            </button>
          </p>
        )}

        {capped && (
          <section className="room-cap">
            <h2>{copy.quota.capped.title}</h2>
            <p className="room-lede">{copy.quota.capped.body}</p>
            <button type="button" className="room-btn primary" disabled={payBusy} onPointerDown={() => void subscribe()}>
              {payBusy ? copy.pay.working : copy.pay.cta}
            </button>
            {payError && <p className="room-error">{payError}</p>}
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
    </main>
  );
}

const withCount = (template: string, n: number) => template.split("{n}").join(String(n));
const withIncluded = (template: string, n: number, included: number) =>
  withCount(template, n).split("{included}").join(String(included));

/* ── the language switch (WS-R24) ───────────────────────────────────────────
 *
 * Two words, both shown, in both locales, always: `ROOM_LANGUAGE_LABELS`'s own
 * header explains why - a follower who can only read one script still has to
 * be able to find the OTHER one's name to reach it. The current locale reads
 * as pressed (`aria-pressed`) rather than disabled, so it stays announced by a
 * screen reader as the state it is. */
function LanguageSwitch({
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
      const joined = await joinRoom(room.room.slug, auth.accessToken, { age18, remember }, room.locale);
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
          <h2>{withName(copy.join.title, name)}</h2>
          <LanguageSwitch locale={locale} busy={localeBusy} onSwitch={onSwitchLocale} />
        </div>
        {/* The card first, and as data. A person answering the memory question
            below has already been told what they are talking to. */}
        <div className="room-card" role="note">
          {room.disclosure.split("\n").map((line) => (
            <p key={line}>{line}</p>
          ))}
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

  return (
    <section className="room-menu" role="dialog" aria-label={copy.menu.title}>
      <h2>{copy.menu.title}</h2>
      {/* WS-R19: real numbers from the follower's own row, never estimated -
          law 5. Renders only for a paid follower with the flag on; a free
          follower's own copy of these fields is always 0 by construction
          (`clientFollower`), so there is nothing honest to show them here. */}
      {ROOM_VOICE_UI && follower?.tier === "paid" && (
        <p className="room-fine">
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
