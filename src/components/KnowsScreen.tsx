// "What she knows" — her memory, as content he can read, correct and delete.
//
// ── the one sentence this screen is built around ──────────────────────────
//
// docs/MEMORY-FELT.md law 4: memory is care, never ammunition and never
// surveillance. That law is usually enforced on HER (no receipts, no clock
// stamps, the tender material raised only when he pulls on it). This is the
// first surface where it has to be enforced on the PRODUCT, and it is worth
// naming why the affect layer is entirely absent from this page rather than
// merely unmentioned: AFFECT-CONTINUITY §1.3 forbids any of it reaching a UI,
// the affect-channel suite (evals/*-channel/run.mjs, its §7) enforces that on
// the bytes of every file in this directory by looking for the words
// themselves, so this comment cannot spell them either. A page about memory is
// exactly where someone would reasonably think that material belonged. It does
// not.
//
// The failure mode this page DOES have is the same shape, and it is specific
// and easy: the honest way to render a memory store is a table with counts at
// the top and a timestamp on every row, and that page is a dossier about a
// person. It
// would be accurate, it would pass every gate in this repo, and it would make
// the product feel like it is watching him.
//
// So, three rules, and they are the reason for nearly every layout decision
// below:
//
//  1. NO COUNTS FIRST. Not one number leads a section. UsScreen is the page
//     with the numbers on it and it earns them (they are a relationship
//     record, and they only ever add up). Here a number would be a claim about
//     how much of him is on file, which is the sentence a surveillance
//     dashboard opens with.
//  2. HUMAN DATES ONLY. "21 aug", never "21 Aug 2026, 3:42pm". A per-row clock
//     stamp is the visual form of the exact sentence her persona brief bans.
//  3. EVERY ROW IS A THING THAT HAPPENED OR A THING SHE BELIEVES. Never a
//     field name, never a table, never a completeness display. Rows appear
//     because the thing is true; a section with nothing in it does not render
//     at all (absence, never a zero — UsScreen's rule 2, and it matters more
//     here, because an empty "facts she holds" heading reads like an accusation
//     that you have not told her enough).
//
// ── what a row can DO, and why it does it that way ────────────────────────
//
// CORRECT ("galat hai") does not write anywhere. It prefills a normal chat
// message and hands him the composer. That is not a shortcut, it is the whole
// point: docs/PRODUCT-SUPERIORITY.md #2's failure (b) is an edit that writes to
// a table the compiler does not read, so correcting a fact changes nothing she
// says. A correction that arrives as a TURN travels the one path that is
// already proven to reach a compiled prompt, and it arrives with the thing
// every direct write loses — her knowing she was corrected.
//
// FORGET rides the EXISTING scoped-forget op (`forgetMemories`, scope "item"),
// which is the same cascade "yeh bhool ja" runs and the same one the settings
// sheet's whole wipe runs a wider version of. It is offered ONLY on rows that
// cascade can actually reach by a term (see state/knows.ts's `forgetTerm`),
// and it is confirmed with the sheet's own confirm idiom, in words, before it
// happens. `activity-forgot-the-teardown` is the filed name for a delete that
// left a row alive in a sibling table; the way this screen does not repeat it
// is by owning no delete of its own.
//
// SURFACE layer only: it reads state and one bundle, writes nothing to
// AppState, and has no opinion about what any of this means.

import { useEffect, useMemo, useRef, useState } from "react";
import type { AppState } from "../state/store";
import type { KnowsBundle, KnowsFact } from "../state/knows";
import {
  factsFrom,
  herSideFrom,
  knowsIsEmpty,
  timelineFrom,
} from "../state/knows";
import { titleFor } from "../engine/milestones";
import { fetchRelState } from "../engine/memory";
import { forgetMemories } from "../engine/memory";
import { HER_NAME } from "../engine/persona";
import { ChevronIcon, TrashIcon, HeartIcon } from "./icons";
import { tap, ImpactStyle } from "../native/haptics";
import { useCallStatus } from "../state/callStatus";
import WorldLayer, { useSky, skyVars } from "./WorldLayer";
import scrapbookArt from "../assets/empty/scrapbook.svg";
import "../styles/knows.css";

export interface KnowsScreenProps {
  state: AppState;
  /** Back to where he came from. Ends nothing; this surface owns no session. */
  onExit: () => void;
  /**
   * Hand him the composer with a correction already started. REQUIRED, and
   * required on purpose: a call site that forgets it is a type error rather
   * than a screen with a button that silently does nothing. Same discipline
   * `SelfBundleInput.sheInitiated` states for itself.
   */
  onCorrect: (prefill: string) => void;
  /**
   * The relational bundle. LEAVE IT UNDEFINED in the app: the screen then does
   * its own `fetchRelState` read, which is the same dedicated read MoreSheet's
   * closeness card and UsScreen use, and is deliberately NOT `takeRelBundle` —
   * that cache is consume-once and belongs to the chat lane's recall timing, so
   * reading it here would starve her next turn of its own bundle. `null` skips
   * the read entirely (the browser battery does this, so it can drive the
   * surface with fixture data and no network).
   */
  bundle?: KnowsBundle | null;
  /** Preview/battery only: freeze "now" so screenshots are deterministic. */
  now?: number;
}

const REDUCED = () => {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
};

export default function KnowsScreen({ state, onExit, onCorrect, bundle, now }: KnowsScreenProps) {
  const root = useRef<HTMLDivElement>(null);
  const nowMs = now ?? Date.now();
  const call = useCallStatus();
  const sky = useSky();

  // `undefined` means "go and read"; an explicit value (bundle or null) is
  // taken as given. Absent/failed/timed-out all render the same thing, which
  // is nothing — never a placeholder, never an apology.
  const [fetched, setFetched] = useState<KnowsBundle | null>(null);
  useEffect(() => {
    if (bundle !== undefined || !state.deviceId) return;
    let live = true;
    fetchRelState(state.deviceId).then((b) => live && setFetched((b as KnowsBundle) ?? null));
    return () => {
      live = false;
    };
  }, [bundle, state.deviceId]);
  const rel = bundle !== undefined ? bundle : fetched;

  // rows this session has already dropped. Optimistic, and only ever written
  // after the server said ok: a row that vanishes before the delete lands is a
  // screen lying about a deletion, which is the one lie this surface cannot
  // afford to tell.
  const [dropped, setDropped] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<KnowsFact | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    if (confirming) setConfirming(null);
    else onExit();
  };

  const months = useMemo(
    () => timelineFrom(state, { titleFor, weEpisodes: rel?.weEpisodes, nowMs }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.messages, state.momentsFired, state.activities, rel, nowMs],
  );
  const facts = useMemo(
    () => factsFrom(state, rel).filter((f) => !dropped.includes(f.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.user, rel, dropped],
  );
  const her = useMemo(() => herSideFrom(state), [state]);
  const empty = knowsIsEmpty(months, facts, her);

  const correct = (f: KnowsFact) => {
    tap(ImpactStyle.Light);
    onCorrect(f.correct);
  };

  const doForget = async (f: KnowsFact) => {
    if (!f.forgetTerm || busy) return;
    setBusy(true);
    const res = await forgetMemories(
      state.deviceId,
      { scope: "item", name: f.forgetTerm },
      state.auth?.accessToken,
    );
    setBusy(false);
    setConfirming(null);
    // A failed call leaves the row exactly where it is. The alternative is a
    // screen that shows a deletion the database never performed, and this is
    // the surface where that particular lie is unforgivable.
    if (res && res.receipt !== "none") setDropped((cur) => [...cur, f.id]);
  };

  const run = !REDUCED();

  return (
    <div
      className="knows"
      ref={root}
      style={skyVars(sky)}
      data-sky={sky.state}
      data-still={run ? undefined : ""}
      tabIndex={-1}
      role="region"
      aria-label={`What ${HER_NAME} knows`}
      onKeyDown={onKeyDown}
    >
      {/* the same wallpaper the thread, the rooms and Us stand on, at the same
          measured veil. A page about her memory rendered on flat paper would be
          the one screen in the app that is not in the world she lives in. */}
      <WorldLayer frame={sky} variant="wallpaper" />

      <div className="knows-head">
        <WorldLayer frame={sky} variant="band" />
        <button
          type="button"
          className="knows-back"
          data-tel="knows.exit"
          onPointerDown={() => tap(ImpactStyle.Light)}
          onClick={onExit}
          aria-label="Back"
        >
          <ChevronIcon size={18} />
          <span>Back</span>
        </button>
        <span className="knows-headline" aria-hidden="true">
          what she remembers
        </span>
        <span className="knows-headpad">
          {(call.live || call.connecting) && (
            <button
              type="button"
              className="knows-callchip"
              data-state={call.connecting ? "connecting" : call.laneDegraded ? "degraded" : "live"}
              data-tel="knows.to_call"
              onClick={onExit}
              aria-label={`Back to the call with ${HER_NAME}. It's still going`}
            >
              <i className="knows-callchip-dot" aria-hidden="true" />
              <span>
                {call.connecting ? "ringing…" : call.laneDegraded ? "voice reduced" : call.mmss || "on call"}
              </span>
            </button>
          )}
        </span>
      </div>

      <div className="knows-scroll">
        {/* ═══ the opening ═══════════════════════════════════════════════
            Two short lines, and neither of them is a number. The first says
            what the page is; the second says what he can do to it, because a
            page you can edit that does not say so is a page nobody edits. */}
        <header className="knows-top">
          <h1 className="knows-title">what she remembers</h1>
          <p className="knows-sub">
            {empty
              ? "Nothing much yet. It fills up as you two talk."
              : "Yours to fix. Tell her when something's wrong, or drop it for good."}
          </p>
          {/* THE EMPTY SCRAPBOOK, drawn once and only when it is true.
              The screen has two `empty` branches, this line and the closing
              one at the foot; the picture is on this one alone, because the
              same illustration twice on one short page reads as a repaint
              rather than as furniture, and the footer sentence is copy that
              was never an art site. The text is untouched either way: the
              picture is added ABOVE it and replaces nothing. */}
          {empty && (
            <img className="knows-empty-art" src={scrapbookArt} alt="" width={260} height={173} />
          )}
        </header>

        {/* ═══ 1. THEIR STORY, BY MONTH ══════════════════════════════════
            Not every message. The things that happened: the day it started,
            what you crossed, the calls, the pictures, the games, and the
            episodes only the two of you bring up. Curated rather than
            complete, which is the difference between a scrapbook and a log. */}
        {months.length > 0 && (
          <section className="knows-sec">
            <h2 className="knows-h">Your story</h2>
            {months.map((m, mi) => (
              <div className="knows-month" key={m.key} style={{ ["--i" as string]: Math.min(mi, 6) }}>
                <h3 className="knows-mlabel">{m.label}</h3>
                <ol className="knows-time">
                  {m.entries.map((e) => (
                    <li className="knows-entry" key={e.id} data-kind={e.kind}>
                      <span className="knows-dot" aria-hidden="true" />
                      <span className="knows-etext">{e.text}</span>
                      <span className="knows-eday">{e.day}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </section>
        )}

        {/* ═══ 2. WHAT SHE HOLDS ABOUT YOU ═══════════════════════════════
            The rows the prompt actually compiles from, in the order a person
            would say them, with the machine-derived ones last. Each carries
            its two ways out. */}
        {facts.length > 0 && (
          <section className="knows-sec">
            <h2 className="knows-h">About you</h2>
            <ul className="knows-facts">
              {facts.map((f, i) => (
                <li className="knows-fact" key={f.id} style={{ ["--i" as string]: Math.min(i, 8) }}>
                  <span className="knows-ftext">{f.text}</span>
                  <span className="knows-facts-row">
                    <button
                      type="button"
                      className="knows-fix"
                      data-tel="knows.correct"
                      onClick={() => correct(f)}
                      aria-label={`Tell her this is wrong: ${f.text}`}
                    >
                      galat hai
                    </button>
                    {f.forgetTerm && (
                      <button
                        type="button"
                        className="knows-drop"
                        data-tel="knows.forget"
                        onClick={() => {
                          tap(ImpactStyle.Light);
                          setConfirming(f);
                        }}
                        aria-label={`Make her forget this: ${f.text}`}
                      >
                        <TrashIcon size={15} />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="knows-note">
              Anything without a bin, just tell her. She takes it from there.
            </p>
          </section>
        )}

        {/* ═══ 3. HER SIDE ═══════════════════════════════════════════════
            docs/MEMORY-FELT.md law 6. Read-only, and that is not an omission:
            this is what SHE said about HER life, and a control that let him
            delete her days would make her a notebook. */}
        {her.length > 0 && (
          <section className="knows-sec">
            <h2 className="knows-h">Her side</h2>
            <ul className="knows-hers">
              {her.map((h, i) => (
                <li className="knows-her" key={h.id} style={{ ["--i" as string]: Math.min(i, 8) }}>
                  <span className="knows-htext">{h.text}</span>
                  <span className="knows-hday">{h.day}</span>
                </li>
              ))}
            </ul>
            <p className="knows-note">What she's told you about her own life.</p>
          </section>
        )}

        <footer className="knows-foot">
          <p className="knows-close">
            {empty
              ? "She starts with nothing and keeps what you give her."
              : "This is all of it. Nothing about you is kept anywhere you can't see."}
          </p>
        </footer>
      </div>

      {/* ═══ the confirm ═══════════════════════════════════════════════════
          The settings sheet's idiom, unchanged: named in words before it
          happens, the destructive verb on the danger button, the way out
          underneath it, and the honest floor about what else goes. A term
          forget takes the fact AND the messages that said it AND the episodes
          it came from, because that is what the cascade does, and a confirm
          that describes a smaller deletion than the one it performs is worse
          than no confirm. */}
      {confirming && (
        <>
          <div className="sheet-veil" onClick={() => setConfirming(null)} />
          <div className="sheet knows-confirm" role="dialog" aria-modal="true" aria-label="Make her forget this?">
            <div className="grab" />
            <h3>Forget this?</h3>
            <p className="confirm-body">
              <b>{confirming.text}</b>
              <br />
              <br />
              {HER_NAME} drops it, and everything that said it: the messages, and what she
              worked out from them. This cannot be undone.
            </p>
            <div className="confirm-actions">
              <button
                className="btn-danger"
                data-tel="knows.forget_confirm"
                disabled={busy}
                onClick={() => void doForget(confirming)}
              >
                <TrashIcon size={18} />
                <span style={{ marginLeft: 8 }}>{busy ? "Forgetting…" : "Forget it"}</span>
              </button>
              <button
                className="btn-ghost"
                style={{ width: "100%" }}
                data-tel="knows.forget_cancel"
                onClick={() => setConfirming(null)}
              >
                Keep it
              </button>
            </div>
            <p className="auth-fine" style={{ marginTop: 16 }}>
              <HeartIcon size={13} /> Everything else stays exactly where it is.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
