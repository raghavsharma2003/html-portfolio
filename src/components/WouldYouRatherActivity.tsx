// WouldYouRatherActivity — the adapter, and the ONLY file that knows this
// activity is would-you-rather. Mirrors `ChessActivity.tsx` deliberately:
// GamesHub lists rows and ActivityShell draws a frame, neither imports
// anything from `engine/wyr`, and this component owns no game state either.
//
// ── COORDINATOR: `state.game` is typed for chess only, today ──────────────
// `src/state/game.ts`'s `GameSession` union does not yet have a "wyr" member
// (see `src/engine/wyr/session.ts`'s header for the exact diff). Until that
// lands, this file reads and writes the shared `AppState.game` slot through
// the two casts directly below — `readWyr`/`asGameSession` — rather than
// through the real union. Once the diff lands, delete both and read/write
// `state.game` plainly, exactly the way `ChessActivity.tsx` does.
//
// That cast also surfaces a real cross-activity question that is NOT this
// file's to resolve: `AppState.game` is ONE slot, so a chess session and a
// wyr session cannot both be "current". `blocked`, below, is this file's
// half of the answer — it refuses to overwrite a foreign session rather than
// silently deleting whatever game was already on the board — but the other
// half (what the hub does, or whether a second slot is warranted) belongs to
// whoever owns `GamesHub`/`App.tsx`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppState } from "../state/store";
import ActivityShell, { type ActivityCall } from "./ActivityShell";
import { cardById } from "../engine/wyr/deck";
import {
  advance,
  answerCurrent,
  currentCardId,
  freshSession,
  isAnswered,
  isEmpty,
  tally,
  type WyrSession,
} from "../engine/wyr/session";
import { herPickDelayMs, type WyrPick } from "../engine/wyr/pick";
import { useCallStatus } from "../state/callStatus";
import { resolveTheme } from "../engine/theme";
import { tap, ImpactStyle } from "../native/haptics";
import "../styles/wyr.css";

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onExit: () => void;
  /** Tapping the call chip should return to the call screen, not end anything. */
  onOpenCall?: () => void;
  /** Start a call FROM the card, same reason ChessActivity offers it: the
   *  whole point is playing while she talks. */
  onStartCall?: () => void;
  /**
   * Stable per-relationship seed for her deterministic pick. Must NOT change
   * session to session — pass something like `state.auth?.userId ??
   * state.deviceId`. Only read when a brand new session is dealt; a session
   * already in progress keeps the salt it was created with.
   */
  salt: string;
}

// Mirrors ChessActivity.tsx's identical constant and identical reasoning: a
// glance at what she just said, not a second chat log.
const HER_LINE_FRESH_MS = 120_000;

// The GameSession union now carries "wyr" for real, so these are plain
// narrows — the coordinator landed the diff this file's header asked for.
function readWyr(g: AppState["game"]): WyrSession | null {
  return g?.kind === "wyr" ? g : null;
}
function asGameSession(w: WyrSession): NonNullable<AppState["game"]> {
  return w;
}

export default function WouldYouRatherActivity({
  state,
  setState,
  onExit,
  onOpenCall,
  onStartCall,
  salt,
}: Props) {
  const raw = state.game ?? null;
  const status = useCallStatus();
  const session = readWyr(raw);

  // See the header: a foreign-kind session already occupies the slot, and
  // this component must not touch it.
  const blocked = Boolean(raw && !session);

  // One tap in deals the first card, same shape as chess dealing a fresh
  // board: re-entering an open session resumes it rather than re-asking.
  useEffect(() => {
    if (blocked) return;
    if (session && !session.closedAt) return;
    setState((s) => {
      const cur = readWyr(s.game);
      if (s.game && !cur) return s; // re-check inside the updater: still blocked
      if (cur && !cur.closedAt) return s;
      return { ...s, game: asGameSession(freshSession(salt, Date.now())) };
    });
  }, [blocked, session, salt, setState]);

  const curId = session ? currentCardId(session) : null;
  const card = curId ? cardById(curId) : undefined;
  const answered = session ? isAnswered(session) : false;
  const { agreed, clashed } = session ? tally(session) : { agreed: 0, clashed: 0 };
  const roundsSoFar = session ? session.rounds.length : 0;
  const lastRound = session && answered ? session.rounds[session.rounds.length - 1] : null;

  // ── the reveal ────────────────────────────────────────────────────────
  // His tap is committed to AppState only once her seeded delay elapses, not
  // before. A reload mid-delay simply loses the transient "waiting on her"
  // beat, not any data — the card is still unanswered, he taps again, and
  // `herPick` being pure means he gets back the identical answer.
  const [pending, setPending] = useState<{ cardId: string; his: WyrPick } | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    },
    [],
  );

  const onPick = useCallback(
    (pick: WyrPick) => {
      if (!session || !card || answered || pending) return;
      tap(ImpactStyle.Light);
      const cardId = card.id;
      const delay = herPickDelayMs(cardId, session.salt);
      setPending({ cardId, his: pick });
      pendingTimer.current = setTimeout(() => {
        tap(ImpactStyle.Light);
        setPending((p) => (p && p.cardId === cardId ? null : p));
        setState((s) => {
          const cur = readWyr(s.game);
          if (!cur || currentCardId(cur) !== cardId) return s; // moved on already
          return { ...s, game: asGameSession(answerCurrent(cur, pick)) };
        });
      }, delay);
    },
    [session, card, answered, pending, setState],
  );

  const onNext = useCallback(() => {
    tap(ImpactStyle.Light);
    setState((s) => {
      const cur = readWyr(s.game);
      return cur ? { ...s, game: asGameSession(advance(cur)) } : s;
    });
  }, [setState]);

  // A card dealt and left with nothing answered is not a session — the wyr
  // analogue of "a board opened and left without a move" (SPEC-GAMES §5).
  const exit = useCallback(() => {
    setState((s) => {
      const cur = readWyr(s.game);
      if (!cur || cur.closedAt) return s;
      return { ...s, game: isEmpty(cur) ? null : asGameSession({ ...cur, closedAt: Date.now() }) };
    });
    onExit();
  }, [onExit, setState]);

  const tone = resolveTheme(state.theme) === "dark" ? "dark" : "paper";
  const call: ActivityCall | null =
    status.live || status.connecting
      ? {
          live: status.live,
          connecting: status.connecting,
          muted: status.muted,
          mmss: status.mmss,
          onToggleMute: status.toggleMute,
          onOpen: onOpenCall,
        }
      : { onStart: onStartCall };

  // Her last line, above the card — off-call only, same reasoning
  // ChessActivity gives: on a call she is audible, and captions over her own
  // voice is the thing this product removed on purpose.
  const herLine = useMemo(() => {
    if (status.live || status.connecting) return null;
    const msgs = state.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.from !== "her") continue;
      if (m.kind !== "text" || !m.text) return null;
      return Date.now() - m.at < HER_LINE_FRESH_MS ? m.text : null;
    }
    return null;
  }, [state.messages, status.live, status.connecting]);

  const showingHerPick = answered && !pending;

  return (
    <ActivityShell
      title="Would you rather"
      onExit={exit}
      call={call}
      note={herLine}
      her={{
        phase: pending ? "thinking" : "idle",
        line: pending ? "deciding…" : showingHerPick ? "picked" : "up for it",
      }}
      tone={tone}
      footer={
        session ? (
          <button
            type="button"
            className="wyr-next"
            data-tel="wyr.next"
            disabled={!answered}
            onClick={onNext}
          >
            Next card
          </button>
        ) : undefined
      }
    >
      {blocked ? (
        <div className="wyr-blocked" role="status">
          Finish or leave the game already on the board before starting this one.
        </div>
      ) : card ? (
        <div className="wyr">
          <div className="wyr-card" data-revealed={showingHerPick ? "yes" : "no"}>
            <button
              type="button"
              className="wyr-opt"
              data-side="a"
              data-mine={pending?.his === "a" || lastRound?.his === "a" ? "yes" : "no"}
              data-hers={showingHerPick && lastRound?.her === "a" ? "yes" : "no"}
              disabled={answered || Boolean(pending)}
              onClick={() => onPick("a")}
            >
              {card.a}
            </button>
            <div className="wyr-or" aria-hidden="true">
              or
            </div>
            <button
              type="button"
              className="wyr-opt"
              data-side="b"
              data-mine={pending?.his === "b" || lastRound?.his === "b" ? "yes" : "no"}
              data-hers={showingHerPick && lastRound?.her === "b" ? "yes" : "no"}
              disabled={answered || Boolean(pending)}
              onClick={() => onPick("b")}
            >
              {card.b}
            </button>
          </div>

          <div className="wyr-status">
            {pending ? (
              <span className="wyr-waiting" aria-live="polite">
                waiting on her…
              </span>
            ) : showingHerPick && lastRound ? (
              <span className="wyr-verdict" data-clash={lastRound.his === lastRound.her ? "no" : "yes"} aria-live="polite">
                {lastRound.his === lastRound.her ? "you agree" : "that's a clash"}
              </span>
            ) : (
              <span className="wyr-hint">tap yours</span>
            )}

            {roundsSoFar > 0 ? (
              <span className="wyr-tally">
                <b>{agreed}</b> agree · <b>{clashed}</b> clash
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </ActivityShell>
  );
}
