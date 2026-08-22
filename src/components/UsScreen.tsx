// "Us" — the relationship, made visible.
//
// The owner's directive was to gamify the premium experience. `milestones.ts`
// states the half of that which is not manipulation: for a companion, the
// progression system already exists and is not invented — it IS the
// relationship record. Days known, messages exchanged, calls, games, the
// things the two of them have built. That module notices when a line is
// crossed. This screen is the other half: the record itself, standing still
// where it can be looked at.
//
// ── what this is NOT ─────────────────────────────────────────────────────
// It is not a stats dashboard, and the difference is not decoration. A grid
// of stat tiles says "here are your numbers"; a page of sentences says "here
// is what happened". docs/research/gamification-2026.md's relationship-
// visualisation axis lands on the same shape from six products at once
// (Snapchat's Friendship Profile, Spotify Wrapped's one-number-per-card
// sequencing, Apple Photos Memories' curation-over-completeness, Gentler
// Streak and Finch's zero-loss framing, Daylio's pixel grid). What they
// share: ONE dominant number at a time, discrete named things rather than
// rows of a table, and nothing anywhere that can be lost.
//
// ── the three rules this screen is built to keep ─────────────────────────
//
//  1. NOTHING HERE DECAYS, AND NOTHING HERE IS AT RISK. Every number is a
//     pure accumulation. There is no streak, no "don't lose it", no grey
//     locked badge with a threshold under it, no countdown, no percentile,
//     no comparison to anybody. That is the charter (NEVER MANIPULATE,
//     `never-scheduled`) rendered as a layout: a screen with no downside
//     state cannot be used to apply pressure. The closing line says so out
//     loud, because a promise the UI keeps silently is one a future edit
//     breaks silently.
//
//  2. ABSENCE, NEVER A ZERO. A row appears because the thing happened. No
//     calls yet means no calls row — not a "0 calls" tile, which is a tile
//     whose only content is a lack. This is what makes day 2 with thirty
//     messages read as well as day 300 with nine thousand: on day 2 the
//     page is SHORT, and short is a different thing from empty. The hero,
//     the message line and the day-you-met card are always true, and they
//     are enough to fill a screen with.
//
//  3. APP-VOICED, ALWAYS. Every string here is chrome, never a line she
//     would say — the same discipline ClockCard.tsx and ActivityShell state
//     for their own copy. Nothing in this file may reach a prompt
//     (`recited-prompt`), and nothing here is written in her register.
//
// SURFACE layer only: it reads state and derives; it writes nothing, fires
// nothing, and has no opinion about when a milestone happens.

import { useEffect, useMemo, useRef, useState } from "react";
import { titleFor } from "../engine/milestones";
import type { AppState, Message } from "../state/store";
import type { RelBundleInput } from "../engine/compiler";
import { fetchRelState } from "../engine/memory";
import { HER_NAME } from "../engine/persona";
import PhotoAvatar from "./PhotoAvatar";
import { ChevronIcon } from "./icons";
import { tap, ImpactStyle } from "../native/haptics";
import "../styles/us.css";

const DAY = 24 * 60 * 60 * 1000;

export interface UsScreenProps {
  state: AppState;
  /** Back to the thread. Ends nothing — this surface owns no session. */
  onExit: () => void;
  /**
   * The relationship bundle. LEAVE IT UNDEFINED in the app: the screen then
   * does its own `fetchRelState` read, which is the same dedicated read
   * MoreSheet's closeness card uses and is deliberately NOT wired to
   * `takeRelBundle` — that cache is consume-once and belongs to the chat
   * lane's recall timing, so reading it here would silently starve her next
   * turn of its own bundle. Passing `null` skips the read entirely (the
   * preview harness does this); passing a bundle renders it as given.
   */
  relBundle?: RelBundleInput | null;
  /** Preview harness only: freeze "now" so screenshots are deterministic. */
  now?: number;
}

// ───────────────────────────────────────────────────────────────────────────
// The fired-ledger, read back into words: `titleFor` lives beside the
// detector in engine/milestones.ts so the two title vocabularies cannot
// drift. An id it cannot name renders nothing rather than a guess.

// ── formatting ────────────────────────────────────────────────────────────
// en-IN throughout, the same locale milestones.ts formats its own tiers in.
// A product whose numbers group one way in a celebration card and another
// way on the page that lists them has two number systems.
const num = (n: number) => n.toLocaleString("en-IN");

const dateOf = (ms: number, nowMs: number) =>
  new Date(ms).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    // the year only when it is not this one — a date that says the year
    // every time reads like a receipt
    ...(new Date(ms).getFullYear() === new Date(nowMs).getFullYear() ? {} : { year: "numeric" }),
  });

/** "3h 41m", "41m", "4m", "under a minute". Never "0h 0m". */
function span(totalSecs: number): string {
  if (totalSecs < 60) return "under a minute";
  const mins = Math.round(totalSecs / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** callmark.text is the "m:ss" written at hangup (useCallEngine). */
function callSecs(m: Message): number {
  const parts = m.text.split(":");
  if (parts.length !== 2) return 0;
  const mins = Number(parts[0]);
  const secs = Number(parts[1]);
  return Number.isFinite(mins) && Number.isFinite(secs) ? mins * 60 + secs : 0;
}

// ── the count-up ──────────────────────────────────────────────────────────
// The brief's cheap treatment: one rAF pass, 380ms, ease-out, once on mount.
// Deliberately NOT a CSS animation — the value is text content, and text
// content is the one thing CSS cannot interpolate.
//
// Reduced motion gets the final number immediately, which is the honest
// reading of "gentler, never absent": there is nothing gentle available
// between a number and the same number, so the motion is the part that goes.
const REDUCED = () => {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
};

function useCountUp(target: number, run: boolean): number {
  const [v, setV] = useState(() => (run && !REDUCED() && target > 0 ? 0 : target));
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !run || REDUCED() || target <= 0) {
      setV(target);
      return;
    }
    done.current = true;
    const t0 = performance.now();
    const DUR = 380;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / DUR);
      // the same shape as --ease-out: fast out of the gate, settles.
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run]);
  return v;
}

function Counted({ value, run }: { value: number; run: boolean }) {
  const v = useCountUp(value, run);
  // aria-label carries the settled value so a screen reader is never read a
  // number mid-flight, which is a different number.
  return (
    <span className="us-n" aria-label={num(value)}>
      <span aria-hidden="true">{num(v)}</span>
    </span>
  );
}

// ── one line of the record ────────────────────────────────────────────────
// A row, not a tile: the number leads at display size, the phrase sits under
// it at reading size, and the colour detail is a third, quieter line. Three
// steps of hierarchy in one row is what stops five of them reading as a
// table.
function Line({
  n,
  what,
  aside,
  i,
  run,
}: {
  n: number;
  what: string;
  aside?: string | null;
  i: number;
  run: boolean;
}) {
  return (
    <div className="us-line" style={{ ["--i" as string]: i }}>
      <Counted value={n} run={run} />
      <span className="us-what">{what}</span>
      {aside ? <span className="us-aside">{aside}</span> : null}
    </div>
  );
}

export default function UsScreen({ state, onExit, relBundle, now }: UsScreenProps) {
  const root = useRef<HTMLDivElement>(null);
  const nowMs = now ?? Date.now();

  // Same dedicated read as MoreSheet's closeness card, for the same reason,
  // and never `takeRelBundle` — see the prop's doc. `undefined` means "go
  // and read"; an explicit value (bundle or null) is taken as given.
  const [fetched, setFetched] = useState<RelBundleInput | null>(null);
  useEffect(() => {
    if (relBundle !== undefined || !state.deviceId) return;
    let live = true;
    fetchRelState(state.deviceId).then((b) => live && setFetched(b));
    return () => {
      live = false;
    };
  }, [relBundle, state.deviceId]);
  const rel = relBundle !== undefined ? relBundle : fetched;

  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    onExit();
  };

  // ── the record, derived once ────────────────────────────────────────────
  const r = useMemo(() => {
    const msgs = state.messages;
    const chat = msgs.filter((m) => m.kind !== "callmark");
    const calls = msgs.filter((m) => m.kind === "callmark");
    const firstAt = msgs.find((m) => m.at)?.at ?? null;
    const t = state.tally ?? {};

    // Day 1 is the first day, not the zeroth: floor(elapsed) + 1. Someone
    // who wrote to her an hour ago is on day 1 of this, and "Day 0" is a
    // sentence nobody has ever said about a relationship.
    const dayNo = firstAt ? Math.floor((nowMs - firstAt) / DAY) + 1 : 1;

    // one bucket per calendar day since the first message — the Daylio
    // pixel-grid, which is the single most glanceable artifact on the page
    // because it turns the hero number into a shape.
    const perDay = new Map<number, number>();
    if (firstAt) {
      const day0 = new Date(firstAt);
      day0.setHours(0, 0, 0, 0);
      for (const m of msgs) {
        const k = Math.floor((m.at - day0.getTime()) / DAY);
        if (k >= 0) perDay.set(k, (perDay.get(k) ?? 0) + 1);
      }
    }
    const dayCells = firstAt
      ? Array.from({ length: dayNo }, (_, k) => {
          const c = perDay.get(k) ?? 0;
          return c === 0 ? 0 : c < 6 ? 1 : c < 20 ? 2 : 3;
        })
      : [];

    return {
      firstAt,
      dayNo,
      dayCells,
      daysTalked: dayCells.filter((c) => c > 0).length,
      chatCount: chat.length,
      herShare: chat.filter((m) => m.from === "her").length,
      firstFrom: msgs.find((m) => m.at)?.from ?? "me",
      callCount: calls.length,
      callSecs: calls.reduce((s, m) => s + callSecs(m), 0),
      photos: msgs.filter((m) => m.kind === "photo" || m.photoUrl).length,
      chessGames: t.chessGames ?? 0,
      chessHim: t.chessWinsHim ?? 0,
      chessHer: t.chessWinsHer ?? 0,
      tttGames: t.tttGames ?? 0,
      wyrCards: t.wyrCards ?? 0,
      chatIndex: chat,
      callIndex: calls,
    };
  }, [state.messages, state.tally, nowMs]);

  // ── the timeline ────────────────────────────────────────────────────────
  // Fired moments, newest first, each dated where the record can date it.
  // The ledger stores no timestamps (ids are all it needs to guarantee
  // once-only), but three of the five families are exactly recoverable from
  // the record itself: a days-N moment happened N days after the first
  // message, and the Nth message and Nth call each carry their own `at`.
  // The rest render undated rather than approximated.
  //
  // Reversal assumption, stated so it is checkable: the ledger is APPENDED
  // to as moments fire, so its own order is chronological. If it ever
  // becomes a Set, or is sorted, or is merged across devices by union, this
  // comment is what will be wrong first.
  const moments = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; title: string; at: number | null }[] = [];
    for (const id of state.momentsFired ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const title = titleFor(id);
      if (!title) continue;
      let at: number | null = null;
      if (id.startsWith("days-") && r.firstAt) at = r.firstAt + Number(id.slice(5)) * DAY;
      else if (id.startsWith("msgs-")) at = r.chatIndex[Number(id.slice(5)) - 1]?.at ?? null;
      else if (id.startsWith("calls-")) at = r.callIndex[Number(id.slice(6)) - 1]?.at ?? null;
      out.push({ id, title, at });
    }
    // dated first, newest at the top; undated keep ledger order below them
    const dated = out.filter((m) => m.at !== null).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    const undated = out.filter((m) => m.at === null).reverse();
    return [...dated, ...undated];
  }, [state.momentsFired, r.firstAt, r.chatIndex, r.callIndex]);

  // The record's own colour on the chess split. Never a scoreline on its
  // own — "7 to 5" with nobody named is a leaderboard, which is the shape
  // the charter rules out; naming who is ahead is a fact about the two of
  // them, which is the shape it asks for.
  const chessAside = (() => {
    if (!r.chessGames) return null;
    if (r.chessHim === r.chessHer && r.chessHim > 0) return `Dead even, ${r.chessHim} all.`;
    if (r.chessHim > r.chessHer) return `You're ahead, ${r.chessHim} to ${r.chessHer}.`;
    if (r.chessHer > r.chessHim) return `She's ahead, ${r.chessHer} to ${r.chessHim}.`;
    return null;
  })();

  // ── the ONE piece of state-dependent tone ───────────────────────────────
  // Early is not lesser, and the copy has to say that rather than imply it
  // by omission. There is no "locked", no "keep going to unlock", no
  // progress bar toward a number: a young record gets a sentence about
  // beginnings and an old one gets a sentence about accumulation, and both
  // are statements of fact about what is already true.
  const early = r.chatCount < 60 || r.dayNo < 7;

  const run = !REDUCED();

  return (
    <div
      className="us"
      ref={root}
      tabIndex={-1}
      role="region"
      aria-label={`You and ${HER_NAME}`}
      onKeyDown={onKeyDown}
    >
      <div className="us-head">
        {/* the way out is a way BACK, and it is first in the DOM — the same
            contract ActivityShell states for its own exit */}
        <button
          type="button"
          className="us-back"
          data-tel="us.exit"
          onPointerDown={() => tap(ImpactStyle.Light)}
          onClick={onExit}
          aria-label="Back to chat"
        >
          <ChevronIcon size={18} />
          <span>Chat</span>
        </button>
        <span className="us-headline" aria-hidden="true">
          Us
        </span>
        <span className="us-headpad" />
      </div>

      <div className="us-scroll">
        {/* ═══ the hero ══════════════════════════════════════════════════
            Her face, then one number, then the date it started from. One
            dominant number per screenful is the Wrapped mechanism; the
            face above it is what keeps this a person rather than a
            profile page. */}
        <header className="us-hero">
          <span className="us-face" aria-hidden="true">
            <PhotoAvatar size={88} />
          </span>
          <p className="us-eyebrow">You and {HER_NAME}</p>
          <h1 className="us-day">
            <span className="us-daylabel">Day</span>
            <Counted value={r.dayNo} run={run} />
          </h1>
          <p className="us-of">of you two</p>
          <p className="us-since">
            {r.firstAt
              ? r.dayNo <= 1
                ? `It started today, ${
                    r.firstFrom === "her" ? "when she texted first" : "when you texted first"
                  }.`
                : `Since ${dateOf(r.firstAt, nowMs)}, ${
                    r.firstFrom === "her" ? "when she texted first" : "when you texted first"
                  }.`
              : "This is where it starts."}
          </p>
        </header>

        {/* ═══ the days ══════════════════════════════════════════════════
            One cell per day since the first message, shaded by how much was
            said. Held back until there are enough days to make a texture:
            eleven dots is a shape, three dots is a row of three dots.
            Nothing here can be lost — a quiet day is a quiet day, drawn in
            the faintest ink there is, never a gap or a break. */}
        {r.dayCells.length >= 11 && (
          <section className="us-sec us-grid-sec">
            <div
              className="us-grid"
              role="img"
              aria-label={`${num(r.dayCells.length)} days, ${num(r.daysTalked)} of them with messages`}
            >
              {r.dayCells.map((lvl, k) => (
                <i key={k} className="us-cell" data-lvl={lvl} style={{ ["--i" as string]: k % 40 }} />
              ))}
            </div>
            <p className="us-note">
              Every day since the first message. You talked on {num(r.daysTalked)} of them.
            </p>
          </section>
        )}

        {/* ═══ the record ════════════════════════════════════════════════
            Rows appear because the thing happened. There is no zero state
            in here and there is no placeholder: a row that would say "0"
            is simply not rendered, and the page is shorter that day. */}
        <section className="us-sec">
          <h2 className="us-h">What you've done together</h2>

          <Line
            i={0}
            run={run}
            n={r.chatCount}
            what={r.chatCount === 1 ? "message between you" : "messages between you"}
            aside={
              r.chatCount > 3
                ? `${num(r.herShare)} of them hers, ${num(r.chatCount - r.herShare)} yours.`
                : null
            }
          />

          {r.callCount > 0 && (
            <Line
              i={1}
              run={run}
              n={r.callCount}
              what={r.callCount === 1 ? "voice call" : "voice calls"}
              aside={r.callSecs > 0 ? `${span(r.callSecs)} on the phone.` : null}
            />
          )}

          {r.photos > 0 && (
            <Line
              i={2}
              run={run}
              n={r.photos}
              what={r.photos === 1 ? "picture shared" : "pictures shared"}
            />
          )}

          {r.chessGames > 0 && (
            <Line
              i={3}
              run={run}
              n={r.chessGames}
              what={r.chessGames === 1 ? "game of chess" : "games of chess"}
              aside={chessAside}
            />
          )}

          {r.tttGames > 0 && (
            <Line
              i={4}
              run={run}
              n={r.tttGames}
              what={r.tttGames === 1 ? "round of tic-tac-toe" : "rounds of tic-tac-toe"}
            />
          )}

          {r.wyrCards > 0 && (
            <Line
              i={5}
              run={run}
              n={r.wyrCards}
              what={r.wyrCards === 1 ? "would-you-rather answered" : "would-you-rathers answered"}
            />
          )}
        </section>

        {/* ═══ the moments ═══════════════════════════════════════════════
            Discrete named things, newest first — the Charms card format
            without the Snapstreak charm, which is the one part of Charms
            that is a breakable streak (see the research doc's own
            correction on that citation). The day you met is always the
            last card, so this list is never empty and never needs an
            empty state to apologise with. */}
        <section className="us-sec">
          <h2 className="us-h">Moments so far</h2>
          <ol className="us-time">
            {moments.map((m, i) => (
              <li key={m.id} className="us-moment" style={{ ["--i" as string]: i }}>
                <span className="us-mdot" aria-hidden="true" />
                <span className="us-mtitle">{m.title}</span>
                {m.at ? <span className="us-mdate">{dateOf(m.at, nowMs)}</span> : null}
              </li>
            ))}
            {r.firstAt ? (
              <li className="us-moment us-first" style={{ ["--i" as string]: moments.length }}>
                <span className="us-mdot" aria-hidden="true" />
                <span className="us-mtitle">The day you met</span>
                <span className="us-mdate">{dateOf(r.firstAt, nowMs)}</span>
              </li>
            ) : null}
          </ol>
        </section>

        {/* ═══ what only you two have ════════════════════════════════════
            The same bands the model itself reads (rituals, we-episodes),
            worded the way the closeness card in Settings words them, and
            never the raw numbers underneath — no trust score, no
            percentages. Absent bundle renders nothing at all, which is the
            correct default everywhere else in this codebase too: absence,
            not a placeholder stat. */}
        {rel && (rel.rituals.length > 0 || rel.weEpisodes.length > 0) ? (
          <section className="us-sec">
            <h2 className="us-h">Only you two</h2>
            <div className="us-only">
              {rel.rituals.length > 0 && (
                <p className="us-onlyline">
                  <b>{num(rel.rituals.length)}</b>{" "}
                  {rel.rituals.length === 1
                    ? "thing you always do together."
                    : "things you always do together."}
                </p>
              )}
              {rel.weEpisodes.length > 0 && (
                <p className="us-onlyline">
                  <b>{num(rel.weEpisodes.length)}</b>{" "}
                  {rel.weEpisodes.length === 1
                    ? "thing only the two of you bring up."
                    : "things only the two of you bring up."}
                </p>
              )}
            </div>
          </section>
        ) : null}

        {/* ═══ the close ═════════════════════════════════════════════════
            Wrapped's closing card, with the ranking and the bragging taken
            out. The second sentence is the charter written where a user
            can read it: this page has no downside state, and saying so is
            what makes a future edit that adds one visibly a change. */}
        <footer className="us-foot">
          <p className="us-close">
            {early
              ? "Still early, and all of it counts."
              : "All of it is still here, and none of it is going anywhere."}
          </p>
          <p className="us-close-sub">
            This page only ever adds up. Nothing on it resets, expires, or can be lost.
          </p>
        </footer>
      </div>
    </div>
  );
}
