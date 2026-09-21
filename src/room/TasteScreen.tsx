// The taste screen, pulled out of RoomApp.tsx into its own file (WS-R139)
// so it can be `React.lazy`-loaded — a follower who has already dismissed
// it once this tab (`tasteDismissed`, RoomApp.tsx's own state) never pays
// for this component's code again, and a returning follower who already
// joined never mounts it at all. See
// `context/decisions.md#ws-r139-room-secondary-screens-are-lazy-chunks`.
//
// Three questions, answered by the creator's AI, from their own material
// alone, before the sign-in wall (WS-R53). No session, no thread — nothing
// sent to or received from the server survives past this one component:
// `tasteInRoom` (roomApi.ts) mints no session, and `exchanges` below lives
// only in this screen's own state, gone the moment the tab is (the SAME
// "stateless by construction" property api/_room-taste.js's own header
// states for the server side of this exact boundary). The join control is
// always present and always works — a stranger who wants to skip straight
// to signing in never has to spend a question first.
//
// A DEFAULT export: `React.lazy(() => import("./TasteScreen"))` requires
// one.
import { useEffect, useRef, useState } from "react";
import { withCount } from "./textHelpers";
import { LanguageSwitch } from "./LanguageSwitch";
import { Localized, LocalizedName, LocalizedDisclosure } from "./Localized";
import { RoomApiError, tasteInRoom, type RoomOpen, type RoomTasteTurn } from "./roomApi";
import type { RoomCopy, RoomLocale } from "./copy";

export default function TasteScreen({
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
