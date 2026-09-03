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
import { ROOM_COPY, withName } from "./copy";
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
  slugFromPath,
  type RoomCitations,
  type RoomOpen,
  type RoomQuota,
  type RoomThread,
} from "./roomApi";
import { RoomPayApiError, startSubscription } from "./roomPayApi";

type Turn = { role: "user" | "assistant"; content: string; fresh?: boolean };
type Phase = "loading" | "unavailable" | "join" | "talking" | "gone";

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
  const foot = useRef<HTMLDivElement | null>(null);

  const name = room?.room.name || room?.room.display_name || "";
  const remembers = room?.follower?.remembers === true;

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
        const opened = await openRoom(slug, restored?.accessToken ?? null);
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
        setError(ROOM_COPY.errors.stale);
      } else if (cause instanceof RoomApiError && cause.code === "room_message_too_long") {
        setError(ROOM_COPY.errors.tooLong);
      } else {
        setError(ROOM_COPY.errors.generic);
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
      setPayError(ROOM_COPY.pay.noLink);
    } catch (cause) {
      if (cause instanceof RoomPayApiError && cause.code === "payments_not_configured") {
        setPayError(ROOM_COPY.pay.notConfigured);
      } else if (cause instanceof RoomPayApiError && cause.code === "room_price_not_set") {
        setPayError(ROOM_COPY.pay.priceNotSet);
      } else if (cause instanceof RoomPayApiError && cause.status === 401) {
        setPayError(ROOM_COPY.errors.stale);
      } else {
        setPayError(ROOM_COPY.pay.failed);
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
      <main className="room-shell">
        <div className="room-thread">
          <p className="room-lede">{ROOM_COPY.loading}</p>
        </div>
      </main>
    );
  }

  if (phase === "unavailable") {
    return (
      <main className="room-shell">
        <section className="room-gone">
          <h2>{ROOM_COPY.unavailable.title}</h2>
          <p className="room-lede">{ROOM_COPY.unavailable.body}</p>
        </section>
      </main>
    );
  }

  if (phase === "gone") {
    return (
      <main className="room-shell">
        <section className="room-gone">
          <h2>{ROOM_COPY.menu.forgetDone}</h2>
          <p className="room-lede">{withName(ROOM_COPY.menu.forgetNote, name)}</p>
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
    <main className="room-shell">
      <header className="room-head">
        <div className="room-head-row">
          <h1>{name ? `${name} AI` : room?.room.display_name}</h1>
          <button type="button" className="room-menu-open" onClick={() => setMenu(true)}>
            {ROOM_COPY.menu.title}
          </button>
        </div>
        {/* ONE statistic, and only if a real count came back. */}
        {typeof talkedToday === "number" && talkedToday > 0 && (
          <p className="room-stat">
            {talkedToday === 1
              ? ROOM_COPY.stats.talkedTodayOne
              : withCount(ROOM_COPY.stats.talkedToday, talkedToday)}
          </p>
        )}
      </header>

      <ThreadRail
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
            ? ROOM_COPY.pulse.working
            : pulseOn[thread ?? ""] === true
              ? ROOM_COPY.pulse.off
              : ROOM_COPY.pulse.on}
        </button>
        <p className="room-pulse-explain">{withName(ROOM_COPY.pulse.explain, name)}</p>
      </div>

      <div className="room-thread">
        {/* The card, as DATA, at the top of the first screen. Never generated,
            never paraphrased, and never below the fold. */}
        <div className="room-card" role="note">
          {(room?.disclosure || "").split("\n").map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>

        {!remembers && <p className="room-fine">{ROOM_COPY.conversation.notRemembering}</p>}

        {turns.map((turn, i) => (
          <div
            key={`${i}-${turn.content.slice(0, 24)}`}
            className={`room-bubble ${turn.role === "user" ? "from-me" : "from-them"}${
              turn.fresh ? " room-bubble-enter" : ""
            }`}
          >
            {turn.content}
          </div>
        ))}

        {sending && (
          <div className="room-typing" aria-label={ROOM_COPY.conversation.thinking}>
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
            {ROOM_COPY.conversation.whereFrom}
          </button>
        )}

        {cite && (
          <div className="room-cite-answer">
            {withName(ROOM_COPY.conversation.citedFrom, cite.name || name)}
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
              ? ROOM_COPY.quota.lastOne
              : withIncluded(ROOM_COPY.quota.left, quota.messages_left, quota.messages_included)}
            {" "}
            <button type="button" className="room-btn" disabled={payBusy} onPointerDown={() => void subscribe()}>
              {payBusy ? ROOM_COPY.pay.working : ROOM_COPY.pay.cta}
            </button>
          </p>
        )}

        {capped && (
          <section className="room-cap">
            <h2>{ROOM_COPY.quota.capped.title}</h2>
            <p className="room-lede">{ROOM_COPY.quota.capped.body}</p>
            <button type="button" className="room-btn primary" disabled={payBusy} onPointerDown={() => void subscribe()}>
              {payBusy ? ROOM_COPY.pay.working : ROOM_COPY.pay.cta}
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
          placeholder={ROOM_COPY.conversation.placeholder}
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
          {ROOM_COPY.conversation.send}
        </button>
      </div>

      {menu && session && (
        <DataMenu
          name={name}
          session={session}
          auth={auth}
          onClose={() => setMenu(false)}
          onForgotten={() => {
            setMenu(false);
            setPhase("gone");
          }}
        />
      )}
    </main>
  );
}

const withCount = (template: string, n: number) => template.split("{n}").join(String(n));
const withIncluded = (template: string, n: number, included: number) =>
  withCount(template, n).split("{included}").join(String(included));

/* ── the thread rail ────────────────────────────────────────────────────── */

function ThreadRail({
  threads,
  active,
  onPick,
  onCreate,
}: {
  threads: RoomThread[];
  active: string | null;
  onPick: (id: string | null) => void;
  onCreate: (title: string) => void | Promise<void>;
}) {
  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState("");
  return (
    <nav className="room-rail" aria-label={ROOM_COPY.threads.title}>
      <button type="button" aria-pressed={active === null} onClick={() => onPick(null)}>
        {ROOM_COPY.threads.all}
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
            aria-label={ROOM_COPY.threads.namePlaceholder}
            placeholder={ROOM_COPY.threads.namePlaceholder}
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
            {ROOM_COPY.threads.save}
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setNaming(true)}>
          {ROOM_COPY.threads.create}
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
  onAuth,
  onJoined,
}: {
  room: RoomOpen;
  name: string;
  auth: StudioSession | null;
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
      setError(ROOM_COPY.errors.signIn);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const joined = await joinRoom(room.room.slug, auth.accessToken, { age18, remember });
      onJoined(joined);
    } catch {
      setError(ROOM_COPY.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="room-shell">
      <section className="room-join">
        <h2>{withName(ROOM_COPY.join.title, name)}</h2>
        {/* The card first, and as data. A person answering the memory question
            below has already been told what they are talking to. */}
        <div className="room-card" role="note">
          {room.disclosure.split("\n").map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <p className="room-lede" style={{ marginTop: "var(--space-item)" }}>
          {ROOM_COPY.join.lede}
        </p>

        {error && <p className="room-error">{error}</p>}

        {!auth && (
          <>
            <h3>{ROOM_COPY.join.signIn}</h3>
            <label className="room-field">
              <span>{ROOM_COPY.join.phoneLabel}</span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={ROOM_COPY.join.phonePlaceholder}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            {codeSent && (
              <label className="room-field">
                <span>{ROOM_COPY.join.codeLabel}</span>
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
                    setError(ROOM_COPY.errors.generic);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? ROOM_COPY.join.working : codeSent ? ROOM_COPY.join.verify : ROOM_COPY.join.sendCode}
              </button>
              <button
                type="button"
                className="room-btn"
                onClick={() => {
                  // Back to THIS room, not to a creator's studio. The path must
                  // also be on the Supabase redirect allow list; see
                  // studioAuth.googleSignIn for that dependency stated in full.
                  void googleSignIn(`/r/${room.room.slug}`).catch(() => setError(ROOM_COPY.errors.generic));
                }}
              >
                {ROOM_COPY.join.google}
              </button>
            </div>
          </>
        )}

        {auth && (
          <>
            <label className="room-check">
              <input type="checkbox" checked={age18} onChange={(e) => setAge18(e.target.checked)} />
              <span>{ROOM_COPY.join.age}</span>
            </label>
            <p className="room-fine">{ROOM_COPY.join.ageWhy}</p>

            {/* THE MEMORY QUESTION. Its own moment, its own words, asked once.
                Both answers are buttons of equal weight: a "no" that is a link
                under a "yes" is not an unbundled question. */}
            <h3>{ROOM_COPY.memory.title}</h3>
            <p className="room-lede">{ROOM_COPY.memory.lede}</p>
            <ul className="room-keeps">
              {ROOM_COPY.memory.keeps.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
            <p className="room-fine">
              {ROOM_COPY.memory.only} {withName(ROOM_COPY.memory.private, name)}{" "}
              {ROOM_COPY.memory.undo}
            </p>
            <div className="room-actions">
              <button
                type="button"
                className="room-btn primary"
                disabled={!age18 || busy}
                onClick={() => void finish(true)}
              >
                {ROOM_COPY.memory.yes}
              </button>
              <button
                type="button"
                className="room-btn"
                disabled={!age18 || busy}
                onClick={() => void finish(false)}
              >
                {ROOM_COPY.memory.no}
              </button>
            </div>
            {/* What "no" means, stated where "no" is chosen. */}
            <p className="room-note">{ROOM_COPY.memory.noMeans}</p>
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
  session,
  auth,
  onClose,
  onForgotten,
}: {
  name: string;
  session: string;
  auth: StudioSession | null;
  onClose: () => void;
  onForgotten: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <section className="room-menu" role="dialog" aria-label={ROOM_COPY.menu.title}>
      <h2>{ROOM_COPY.menu.title}</h2>
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
              setError(ROOM_COPY.errors.generic);
            } finally {
              setBusy(false);
            }
          }}
        >
          {ROOM_COPY.menu.download}
        </button>
        <p className="room-fine">{ROOM_COPY.menu.downloadNote}</p>

        {!confirming ? (
          <button type="button" className="room-btn danger" onClick={() => setConfirming(true)}>
            {ROOM_COPY.menu.forget}
          </button>
        ) : (
          <>
            <p className="room-fine">{withName(ROOM_COPY.menu.forgetNote, name)}</p>
            <button
              type="button"
              className="room-btn danger"
              disabled={busy || !auth}
              onClick={async () => {
                if (!auth) return;
                setBusy(true);
                try {
                  await forgetRoomData(session, auth.accessToken);
                  onForgotten();
                } catch {
                  setError(ROOM_COPY.errors.generic);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {ROOM_COPY.menu.forgetConfirm}
            </button>
            <button type="button" className="room-btn" onClick={() => setConfirming(false)}>
              {ROOM_COPY.menu.forgetCancel}
            </button>
          </>
        )}

        <button type="button" className="room-btn" onClick={onClose}>
          {ROOM_COPY.menu.close}
        </button>
      </div>
    </section>
  );
}

/** Exported for the layout fixture, which needs the stored session helper to
 *  stay a single implementation rather than a second one beside it. */
export { readStoredSession };
