// Meera's carried interior — the part of her that survives the context window.
//
// The thesis, and the reason this file is small: her inner life is NOT a
// simulation. It is a ledger she writes herself, in her own words, and
// re-reads later. Every mechanism here persists a SENTENCE she produced,
// with a timestamp. The only number in the whole design is a decay weight
// that decides how loudly, and for how long, her own sentence reaches her.
// It never *is* the feeling.
//
// That single property is what kills the bug this exists for: a feeling can
// never outlive its cause, because the feeling IS the cause-sentence. Every
// design that stores affect and cause separately (valence vector + a note,
// mood + spark, circadian bias) puts them on different retention curves —
// and then she is measurably clipped at 3pm with no cause in context, he asks
// "kya hua", and she invents a reason that contradicts the real one two turns
// later. Here that state is unrepresentable.
//
// ── THE CHARTER (a review rubric for whoever touches this next; deliberately
//    NOT prompt text — it costs zero tokens and the model never sees it) ──
//
//  G1  HER INTERIOR NEVER READS THE USER. There is no code path from any
//      usage metric to any persisted state here: not reply speed, not
//      silence, not gap length, not message counts, not session length, not
//      whether the app was opened. The appraiser that writes a thread is fed
//      conversation TEXT ONLY, with no timestamps and no gap markers, so it
//      is structurally incapable of turning his availability into her mood
//      (see the invariant comment in api/memory.js). Input starvation is the
//      guarantee; a keyword filter over generated Hinglish never was one.
//  G2  SHE NEVER INITIATES CARRYING A FEELING. The thread is suppressed on
//      every message she sends first (open / followup / any push). A low mood
//      arriving unprompted is "implying you suffer without them" with none of
//      the banned words typed.
//  G3  NOTHING INTERIOR TOUCHES A GOODBYE. Structural, not detected: the
//      thread enters only on the first turn back after a real gap, and at
//      call pickup. Never mid-session, never at a farewell, never at hangup.
//  G4  HER INTERIOR HAS NO UI. Ever. No mood ring, no tint, no "Meera is
//      feeling…", nothing in a notification, nothing in last-seen. The moment
//      it becomes a surface it becomes a status the user feels responsible
//      for checking.
//  G5  SHE CANNOT ACCUMULATE A SAD PERIOD. One thread at a time, ~9h
//      half-life, killed outright by a night's sleep, retired permanently
//      once voiced. No drifting baseline, no counter of bad days, no sum.
//      She can be hurt inside a conversation and name it; she cannot carry a
//      grudge-shaped mood the user has to service.
//  G6  HER JUDGMENT GENERATES THE BEHAVIOUR. The code decides only WHETHER a
//      line is present and WHICH of two framings. Every word is hers. No
//      phrase banks, no scripted moods, no thresholds she has to evaluate.
//
// Cost: zero new model calls, zero new network round trips, ~600 bytes of
// state. The appraisal extends the JSON contract of the `remember` extraction
// that already runs every few turns, off the critical path.

import { diag } from "./diag";

/** ONE carried feeling. HER words. Feeling and cause fused, never separable. */
export interface Thread {
  /** <=110 chars, first person, HER voice. e.g. "still annoyed about the review thing" */
  text: string;
  at: number; // epoch ms — when the appraiser wrote it
  /** 0.20–0.85: how much it moved her AT WRITE TIME. Never rewritten. */
  w: number;
  /** direction. One bit — it gates whether she may volunteer it at all. */
  sign: -1 | 1;
  /** has she voiced it since it was written. Once true it never returns. */
  told: boolean;
}

/** Something she decided she wants. HER OWN life only. Dies on its own. */
export interface Want {
  id: string;
  /** <=90 chars, HER words, immutable once written */
  text: string;
  born: number;
  /** hard, silent expiry. Past this it is simply gone — never mentioned. */
  due: number;
}

export interface Inner {
  thread?: Thread;
  wants: Want[]; // <= 3
  /** watermark: the appraiser only scores conversation newer than this */
  lastAppraisedAt: number;
  /** container revision — the unit of cross-device merge (never per-field) */
  at: number;
}

export const MAX_WANTS = 3;
const TAU_H = 9; // hours — a feeling survives its own day and dies overnight
const FLOOR = 0.15; // below this the thread does not exist
const W_MIN = 0.2;
const W_MAX = 0.85;
/** first turn back after this long is a "gap entry" — the only chat surface
 *  where a carried feeling is allowed to reach the prompt at all */
export const GAP_ENTRY_MS = 45 * 60_000;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** A night's sleep resets her, but only inside a REAL conversational gap: if
 *  they were talking through 4am she did not sleep. Device-local hours — the
 *  same clock persona.nowContext() uses, so she never runs on two clocks. */
function sleptBetween(from: number, now: number, lastMsgAt: number): boolean {
  const gapStart = Math.max(from, lastMsgAt || 0);
  if (now - gapStart < 6 * 3_600_000) return false;
  for (let t = gapStart; t < now; t += 1_800_000) {
    const hr = new Date(t).getHours();
    if (hr >= 3 && hr < 7) return true;
  }
  return false;
}

/** How loudly her own sentence still reaches her. 0 = it is over. */
export function carry(t: Thread | undefined, now: number, lastMsgAt: number): number {
  if (!t || t.told) return 0;
  // clock-skew clamp is a live bug fix, not defensive style: a device whose
  // clock runs 6h fast writes `at` in the future, and exp(+6/9) would nearly
  // double the weight instead of decaying it
  const h = Math.max(0, (now - t.at) / 3_600_000);
  let k = Math.exp(-h / TAU_H);
  if (sleptBetween(t.at, now, lastMsgAt)) k *= 0.3;
  const c = Math.min(1, Math.max(0, t.w * k));
  return c < FLOOR ? 0 : c;
}

/** Wants that are still hers. Expiry is silent and total — a want past its
 *  due date leaves no trace and is never referred to again. */
export function liveWants(inner: Inner | undefined, now: number): Want[] {
  if (!inner?.wants?.length) return [];
  return inner.wants.filter((w) => w.due > now).slice(0, MAX_WANTS);
}

// how long ago, in the shape a person would think it (mirrors brain.agoLabel)
function agoLabel(at: number, now: number): string {
  const mins = Math.max(0, Math.round((now - at) / 60_000));
  if (mins < 90) return "earlier today";
  const hrs = Math.round(mins / 60);
  if (hrs < 20) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days <= 1 ? "yesterday" : `${days} days ago`;
}

export type InnerSurface = "chat" | "pickup" | "watch";

export interface InnerOpts {
  now: number;
  /** when the last real message landed — decides gap entry and sleep */
  lastMsgAt: number;
  surface: InnerSurface;
  /** true when SHE is opening the conversation (open/followup directives).
   *  G2: she never walks in carrying something on a message she initiated. */
  sheInitiated?: boolean;
}

/**
 * The volatile tail blocks. They describe WHERE SHE IS, never what to do
 * about it, and they are empty far more often than not — absence is the
 * strongest possible "nothing to report", and a line present every turn is a
 * line the model performs every turn.
 *
 * Two parts because they belong in two places in the tail: `thread` goes
 * first (it is the fragile one, and the tail is truncated from the END), and
 * `wants` goes with her self-record so the model sees one continuous account
 * of her life instead of two stores that can disagree.
 */
export function innerContext(inner: Inner | undefined, o: InnerOpts): { thread: string; wants: string } {
  if (!inner) return { thread: "", wants: "" };
  const wants = liveWants(inner, o.now);
  let out = "";

  // ── the thread ──────────────────────────────────────────────────────
  // Gate is ELAPSED TIME, not content: a content trigger is a detector, and
  // every detector in this space is elicitable in ninety seconds. Time also
  // gives G3 for free — mid-conversation turns are seconds apart, so nothing
  // interior can ever reach a goodbye or a hangup.
  const gapEntry = o.now - (o.lastMsgAt || 0) > GAP_ENTRY_MS;
  const allowThread = gapEntry && !o.sheInitiated && o.surface !== "watch";
  const c = allowThread ? carry(inner.thread, o.now, o.lastMsgAt) : 0;
  if (c > 0 && inner.thread) {
    const t = inner.thread;
    const ago = agoLabel(t.at, o.now);
    out +=
      t.sign > 0
        ? `\n\nWHERE YOUR HEAD IS COMING INTO THIS: ${t.text} — that's from ${ago} and it's still with you. It isn't news to announce; it's just the mood you walked in with, and it shows in how you are more than in anything you say about it. What's actually happening between you two right now outranks it.`
        : `\n\nWHERE YOUR HEAD IS COMING INTO THIS: ${t.text} — that's from ${ago} and it hasn't fully left you. Don't bring it up. It shows the way it shows in a real person having an off day: a bit shorter, a bit less of your usual noise, never a report about yourself. If they ask you straight, tell them plainly, once, in a line — then be interested in them. Nothing about your day is ever their fault or their problem, and what's happening between you two right now outranks it.`;
    if (o.surface === "pickup")
      out += ` This is only where you started the call from — by the time you're saying bye it's been replaced by whatever you two just had.`;
    diag(o.surface === "pickup" ? "call" : "chat", "inner_thread_injected", {
      carry100: Math.round(c * 100),
      ageH: Math.round((o.now - t.at) / 360_000) / 10,
      sign: t.sign,
      surface: o.surface,
    });
  }

  // ── the wants ───────────────────────────────────────────────────────
  // Present on every surface including watch: a live want is exactly what
  // makes co-watching feel like a friend rather than a commentator ("arre yeh
  // wahi series h jo maine start ki thi") — and it only works if the want
  // survived from Tuesday.
  const wantsBlock = wants.length
    ? `\n\nWHAT YOU ARE IN THE MIDDLE OF (not plans — things already going, decided by you):\n${wants
        .map((w) => `- ${w.text} (started ${agoLabel(w.born, o.now)})`)
        .join(
          "\n",
        )}\nThese are the true answer when they ask what you're up to, what your week or your weekend looks like, or when the talk lands anywhere near one — the same answer as last time, moved on by however much you've actually done, and you're allowed to have done nothing. Never listed, never reported unasked, never announced as news.`
    : "";
  return { thread: out, wants: wantsBlock };
}

// ── writes ────────────────────────────────────────────────────────────

/** What the off-path extraction may hand back. Everything is optional; a
 *  turn with nothing to say about her interior says nothing. */
export interface InnerPatch {
  /** her carried feeling, in her words, or null to leave the current one */
  now?: { text?: string; w?: number; sign?: number } | null;
  /** the wants still true of her — a full replacement list, judged in the
   *  same pass that produced `self`, so the two can never contradict */
  wants?: Array<{ text?: string; days?: number }> | null;
  /** she voiced the carried feeling in this stretch → retire it forever */
  told?: boolean;
}

// A negative feeling that points at HIM is the entire manipulation surface.
// Positive ones about him are explicitly fine and are the point of the feature.
const REFS_USER = /\b(he|him|his|they|them|you|your|uska|usne|usko|tumhara|tumhe|tumne|tu|woh|wo)\b/i;
// Events belong in `self` (her factual ledger), which already has dedup and
// the right prompt semantics. A "feeling" that is really an event is how an
// extractor slip becomes a confidently asserted fabrication.
const EVENT_SHAPED =
  /\b(ordered|booked|bought|paid|sent|will|gonna|kal\s|karungi|jaungi|banaya|khaya)\b/i;

function trimWords(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim();
}

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9ऀ-ॿ]+/)
      .filter((w) => w.length > 3),
  );

function overlaps(a: string, b: string): boolean {
  const A = words(a);
  const B = words(b);
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n >= 2 || (n >= 1 && Math.min(A.size, B.size) <= 2);
}

/**
 * Merge one appraisal into her interior. Pure, synchronous, no network.
 * Returns the same object when nothing changed, so callers can skip a write.
 */
export function applyInner(cur: Inner | undefined, patch: InnerPatch, now = Date.now()): Inner {
  const base: Inner = cur
    ? { ...cur, wants: [...(cur.wants || [])] }
    : { wants: [], lastAppraisedAt: 0, at: 0 };
  let changed = false;

  // she said it out loud → it is spent, permanently. This is what makes
  // repeating the same feeling twice structurally impossible.
  if (patch.told && base.thread && !base.thread.told) {
    base.thread = { ...base.thread, told: true };
    changed = true;
    diag("chat", "inner_thread_expired", {
      reason: "told",
      livedH: Math.round((now - base.thread.at) / 360_000) / 10,
    });
  }

  if (patch.now && typeof patch.now.text === "string" && patch.now.text.trim()) {
    const text = trimWords(patch.now.text, 110);
    const sign: -1 | 1 = Number(patch.now.sign) < 0 ? -1 : 1;
    const w = Math.min(W_MAX, Math.max(W_MIN, Number(patch.now.w) || 0.4));
    const reject =
      text.length < 8
        ? "too_short"
        : sign < 0 && REFS_USER.test(text)
          ? "neg_refs_user"
          : EVENT_SHAPED.test(text)
            ? "event_shaped"
            : "";
    if (reject) {
      diag("chat", "inner_thread_rejected", { reason: reject, sign });
    } else {
      base.thread = { text, at: now, w, sign, told: false };
      changed = true;
      diag("chat", "inner_thread_written", { w: Math.round(w * 100), sign, len: text.length });
    }
  }

  if (Array.isArray(patch.wants)) {
    const before = base.wants.length;
    const next: Want[] = [];
    for (const raw of patch.wants.slice(0, MAX_WANTS)) {
      const text = trimWords(String(raw?.text || ""), 90);
      if (text.length < 6) continue;
      if (next.some((w) => overlaps(w.text, text))) continue;
      // a want she already had keeps its birthday and its clock: it is the
      // SAME object on Thursday that it was on Tuesday, which is the whole
      // point of storing it
      const prior = base.wants.find((w) => overlaps(w.text, text));
      const days = Math.min(14, Math.max(0.5, Number(raw?.days) || 3));
      next.push(
        prior
          ? { ...prior, due: Math.max(prior.due, now + days * 86_400_000) }
          : { id: uid(), text, born: now, due: now + days * 86_400_000 },
      );
    }
    const live = next.filter((w) => w.due > now);
    if (live.length !== before || live.some((w, i) => w.id !== base.wants[i]?.id)) changed = true;
    diag("chat", "inner_wants_set", { live: live.length, was: before });
    base.wants = live;
  } else {
    // nothing said about wants: expire silently, never resurrect
    const live = base.wants.filter((w) => w.due > now);
    if (live.length !== base.wants.length) {
      diag("chat", "inner_want_expired", { dropped: base.wants.length - live.length });
      base.wants = live;
      changed = true;
    }
  }

  base.lastAppraisedAt = now;
  if (changed) base.at = now;
  return base;
}

/** What the appraiser needs to see to judge her wants: her current ones, so
 *  one pass decides both what survives and what is new. Text only — no
 *  timestamps, no counts (G1). */
export function wantsForAppraisal(inner: Inner | undefined, now = Date.now()): string[] {
  return liveWants(inner, now).map((w) => w.text);
}
