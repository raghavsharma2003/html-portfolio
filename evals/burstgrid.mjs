// THE SCENARIO GRID — first-message shape × follow-up timing × device shape ×
// his rhythm, every cell driven through the REAL surface clock in virtual time.
//
// WHY A GRID AND NOT MORE PATCHES. The owner's answer to "there will be
// thousands of cases" was never a list of cases; it was that the thing has to
// behave like a person across the whole space. Three waves of this feature have
// shipped and the same complaint came back — "she replies too fast… doesn't
// give me room to breathe… I don't know why it keeps happening" — because each
// wave fixed the shapes it could think of and the space was never swept. The
// hole that recurred (a COMPLETE-looking sentence followed by a think-pause) is
// the most ordinary cell in the grid and had no test anywhere.
//
// So this file does not assert timings cell by cell. Hand-written expectations
// for 200+ cells rot, and a table of numbers is not a model. It asserts the
// PROPERTIES the human model is made of, on every cell:
//
//   P1  NEVER CUT HIM OFF   — if he reaches the composer inside the breath, she
//                             does not speak before he does.
//   P2  LIVENESS            — she always speaks, within BURST_INTERJECT_MS.
//   P3  THE FLOOR           — she never speaks before the shape's own wait.
//   P4  NO DEAD AIR         — with no engagement at all, she is not slower than
//                             the wait plus one recheck.
//   P5  HANDOFF IS FAST     — a question aimed at her, and "hello??", stay
//                             quick; the patience is paid for by the shapes
//                             that deserve it, not by every turn.
//   P6  THE THINK-PAUSE     — typed-then-paused sits strictly between the two
//                             cliffs the shipped system had (1.3s and 13.3s).
//   P7  DEVICE PARITY       — the Android event shape (input events, a keyboard
//                             that resizes the viewport, and NO keydown at all)
//                             produces the same timing as the web one.
//
// The clock below is `Chat.tsx`'s `armBurst` honestly: ask, sleep for exactly
// the `recheckMs` it is handed, ask again. Nothing here sleeps in real time.
import {
  burstDecide,
  recentUserGaps,
  unansweredTail,
  followUpRate,
  BURST_MIN_MS,
  BURST_GRACE_FLOOR_MS,
  BURST_HANDOFF_MS,
  BURST_CONT_MAX_MS,
  BURST_MAX_MS,
  BURST_INTERJECT_MS,
  COMPOSE_ACTIVE_MS,
  FOCUS_HOLD_MS,
  SETTLE_MS,
} from "./.bundle.mjs";

let fail = 0;
let n = 0;
const ok = (name, cond, extra = "") => {
  n++;
  if (!cond) { fail++; console.log(`FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const T0 = 1_700_000_000_000;

// ── the surface clock, in virtual time ─────────────────────────────────────
//
// `events` is the thread; `signals(t)` is what the composer looks like at t.
// The loop re-arms exactly the way `armBurst` does, including waking early for
// a message of his that lands before the next recheck (the surface re-arms on
// send, so a sim that slept through one would be measuring a different product).
function drive(scn, horizon = 40_000) {
  const hist = (scn.hist || []).map((m) => ({ kind: "text", ...m, at: T0 + m.at }));
  const his = scn.his.map((m) => ({ from: "me", kind: "text", ...m, at: T0 + m.at }));
  const events = [...hist, ...his].sort((a, b) => a.at - b.at);
  let t = 0;
  for (let guard = 0; guard < 5_000; guard++) {
    const now = T0 + t;
    const turns = events.filter((m) => m.at <= now);
    const tail = unansweredTail(turns);
    if (!tail.firstAt) { t += 50; if (t > horizon) break; continue; }
    const c = scn.compose(t);
    const d = burstDecide({
      now,
      firstUnansweredAt: tail.firstAt,
      lastUserAt: tail.lastAt,
      gaps: recentUserGaps(turns),
      his: tail.texts,
      herLast: tail.herLast,
      draftLength: c.draftLength,
      lastKeyAt: c.lastKeyAt ? T0 + c.lastKeyAt : 0,
      followUpRate: followUpRate(turns),
      composerFocused: c.composerFocused,
      keyboardOpen: c.keyboardOpen,
      lastEngagedAt: c.lastEngagedAt ? T0 + c.lastEngagedAt : 0,
    });
    if (d.fire) {
      const lastHis = his[his.length - 1].at - T0;
      return { t, rel: t - lastHis, reason: d.reason, waitMs: d.waitMs, cont: d.continuation.reason, done: d.completion.reason };
    }
    if (d.recheckMs <= 0) return { t, rel: Infinity, reason: "ZERO-RECHECK" };
    const next = events.find((m) => m.at > now);
    const step = Math.max(1, d.recheckMs);
    t = next && next.at - now < step ? next.at - T0 : t + step;
    if (t > horizon) break;
  }
  return { t: Infinity, rel: Infinity, reason: "NEVER" };
}

// ── axis 1: what he sent ───────────────────────────────────────────────────
//
// `wait` is the breath this shape is entitled to with NO rhythm — P3's floor,
// and P4's exact expectation for the stranger. `cap` is the most any rhythm can
// buy this shape — P4's bound for everyone else. Both are written out here
// rather than read from the policy, so a change to the policy has to be a
// change to this file too.
const SHAPES = [
  { id: "complete", text: "U can call me", wait: BURST_GRACE_FLOOR_MS, cap: BURST_MAX_MS },
  { id: "complete-2", text: "ok cool", wait: BURST_GRACE_FLOOR_MS, cap: BURST_MAX_MS },
  { id: "statement", text: "kal office gaya tha", wait: BURST_GRACE_FLOOR_MS, cap: BURST_MAX_MS },
  { id: "muttered-q", text: "1000 rupay?", wait: BURST_GRACE_FLOOR_MS, cap: BURST_MAX_MS },
  { id: "handoff-q", text: "kya kar rahi ho?", wait: BURST_HANDOFF_MS, cap: BURST_HANDOFF_MS, fast: true },
  { id: "handoff-phrase", text: "tum batao", wait: BURST_HANDOFF_MS, cap: BURST_HANDOFF_MS, fast: true },
  { id: "checkin", text: "hello??", wait: BURST_MIN_MS, cap: BURST_MIN_MS, fast: true },
  { id: "cue-greeting", text: "hello", wait: BURST_GRACE_FLOOR_MS + 1_800, cap: BURST_CONT_MAX_MS },
  { id: "cue-opener", text: "wait", wait: BURST_GRACE_FLOOR_MS + 1_800, cap: BURST_CONT_MAX_MS },
  { id: "hinge", text: "kal office gaya aur", wait: BURST_GRACE_FLOOR_MS + 1_100, cap: BURST_CONT_MAX_MS },
  { id: "enumeration", text: "1) pehli baat", wait: BURST_GRACE_FLOOR_MS + 1_800, cap: BURST_CONT_MAX_MS },
];

// ── axis 2: what he does next ──────────────────────────────────────────────
//
// Each returns the composer's state at t, and — for P1 — `engageAt`, the moment
// he first touches it. `null` means he never does.
//
// A NOTE ON `engageAt` AND THE SEND. The composer keeps focus and the keyboard
// stays up across a send, so "focused" at t=0 is not an act and every follower
// below starts from the state his own send left behind. That asymmetry is the
// thing `burstDecide`'s freshness gate encodes, and P1 would be trivially true
// without it.
const FOLLOWERS = [
  { id: "types@0.5s", engageAt: 500, typing: { from: 500, keys: 14, perKey: 180 } },
  { id: "types@1.5s", engageAt: 1_500, typing: { from: 1_500, keys: 14, perKey: 180 } },
  { id: "types@2s", engageAt: 2_000, typing: { from: 2_000, keys: 14, perKey: 180 } },
  { id: "types@4s", engageAt: 4_000, typing: { from: 4_000, keys: 14, perKey: 180 } },
  { id: "types@8s", engageAt: 8_000, typing: { from: 8_000, keys: 14, perKey: 180 } },
  { id: "types-long@2s", engageAt: 2_000, typing: { from: 2_000, keys: 120, perKey: 90 } },
  { id: "typed@0.5s-then-paused", engageAt: 500, typing: { from: 500, keys: 6, perKey: 180 }, thinkPause: true },
  { id: "focus@1.5s-idle", engageAt: 1_500, focusFrom: 1_500 },
  { id: "focus@3s-idle", engageAt: 3_000, focusFrom: 3_000 },
  { id: "focus@1s-then-leaves@2.5s", engageAt: 1_000, focusFrom: 1_000, focusUntil: 2_500 },
  { id: "nothing", engageAt: null },
];

/**
 * @param device "web" — focus events and keydowns, as a desktop browser sends
 *               them; "android" — the WebView shape: an `input` event per
 *               commit with NO keydown at all, and the soft keyboard sensed
 *               only as a viewport collapse. P7 says these must agree.
 */
function composer(f, device) {
  return (t) => {
    const st = { draftLength: 0, lastKeyAt: 0, composerFocused: false, keyboardOpen: false, lastEngagedAt: 0 };
    if (f.engageAt === null || t < f.engageAt) return st;
    // reaching the box is the act, however the device reports it
    if (device === "web") st.composerFocused = true;
    else st.keyboardOpen = true;
    st.lastEngagedAt = f.engageAt;
    if (f.focusUntil != null && t >= f.focusUntil) {
      st.composerFocused = false;
      st.keyboardOpen = false;
    }
    if (f.typing) {
      const k = Math.min(f.typing.keys, Math.floor((t - f.typing.from) / f.typing.perKey) + 1);
      if (k > 0) {
        st.draftLength = k;
        st.lastKeyAt = f.typing.from + (k - 1) * f.typing.perKey;
        st.lastEngagedAt = Math.max(st.lastEngagedAt, st.lastKeyAt);
      }
    }
    return st;
  };
}

// ── axis 4: who he is ──────────────────────────────────────────────────────
const RHYTHMS = [
  { id: "stranger", hist: [] },
  {
    id: "doubler",
    hist: (() => {
      const h = [];
      for (let i = 0; i < 5; i++) {
        h.push({ from: "me", text: "a", at: -400_000 + i * 60_000 });
        h.push({ from: "me", text: "b", at: -400_000 + i * 60_000 + 2_400 });
        h.push({ from: "her", text: "hmm", at: -400_000 + i * 60_000 + 20_000 });
      }
      return h;
    })(),
  },
];

// ── the sweep ──────────────────────────────────────────────────────────────
const RECHECK_SLOP = 250; // one tick of the surface's own granularity
let cells = 0;
const cut = [];
const table = [];

for (const r of RHYTHMS) {
  for (const shape of SHAPES) {
    for (const f of FOLLOWERS) {
      for (const device of ["web", "android"]) {
        cells++;
        const scn = { hist: r.hist, his: [{ at: 0, text: shape.text }], compose: composer(f, device) };
        const got = drive(scn);
        const id = `${r.id}/${shape.id}/${f.id}/${device}`;
        table.push({ id, r: r.id, shape: shape.id, f: f.id, device, rel: got.rel, reason: got.reason });

        // P2 — LIVENESS. Nothing in this grid may stall her.
        ok(`P2 liveness ${id}`, got.rel !== Infinity && got.rel <= BURST_INTERJECT_MS, JSON.stringify(got));

        // P3 — THE FLOOR. She never speaks before this shape's own wait.
        ok(`P3 floor ${id}`, got.rel >= shape.wait, `fired at ${got.rel}, floor ${shape.wait}`);

        // P1 — NEVER CUT HIM OFF. If he reaches the composer while the breath
        // is still running, she must not already have spoken. This is the
        // owner's report, stated as a property over the whole grid.
        if (f.engageAt !== null && f.engageAt <= shape.wait) {
          const cutOff = got.rel <= f.engageAt;
          if (cutOff) cut.push(id);
          ok(`P1 not-cut-off ${id}`, !cutOff, `fired at ${got.rel}, he reached the box at ${f.engageAt}`);
        }

        // P4 — NO DEAD AIR. Doing nothing must not summon a hold.
        if (f.engageAt === null) {
          // everyone: never past what the policy's own ceiling allows this shape
          ok(`P4 no-dead-air ${id}`, got.rel <= shape.cap + RECHECK_SLOP, `fired at ${got.rel}, cap ${shape.cap}`);
          // a stranger: exactly the shape's own wait, to the millisecond
          if (r.id === "stranger") {
            ok(`P4 stranger-exact ${id}`, got.rel === shape.wait, `fired at ${got.rel}, wait ${shape.wait}`);
          }
          // …and someone who doubles is answered no FASTER than a stranger:
          // learning may only buy patience, never spend it.
          ok(`P4 learning-only-adds ${id}`, got.rel >= shape.wait, `fired at ${got.rel}, stranger's wait ${shape.wait}`);
        }

        // P5 — HANDOFF IS FAST. The shapes that hand her the floor stay quick
        // when he is not at the keyboard, so patience is not charged on turns
        // that did not ask for it.
        if (shape.fast && f.engageAt === null) {
          ok(`P5 handoff-fast ${id}`, got.rel <= BURST_HANDOFF_MS + RECHECK_SLOP, `fired at ${got.rel}`);
        }

        // P6 — THE THINK-PAUSE. Typed six characters and stopped: strictly
        // longer than the composing window (she does not cut a paused thought
        // off) and strictly shorter than the flat ten-second budget the shipped
        // system charged for it, which measured 13.31s of silence in the browser.
        if (f.thinkPause) {
          ok(`P6 think-pause holds ${id}`, got.rel > f.engageAt + COMPOSE_ACTIVE_MS, `fired at ${got.rel}`);
          ok(`P6 think-pause is not a cliff ${id}`, got.rel < 10_000, `fired at ${got.rel}`);
        }
      }
    }
  }
}

// P7 — DEVICE PARITY, over every (rhythm, shape, follower) pair.
{
  const byKey = new Map();
  for (const row of table) byKey.set(`${row.r}/${row.shape}/${row.f}/${row.device}`, row);
  let mismatches = 0;
  for (const row of table) {
    if (row.device !== "web") continue;
    const a = row;
    const b = byKey.get(`${row.r}/${row.shape}/${row.f}/android`);
    const same = b && Math.abs(a.rel - b.rel) <= 1 && a.reason === b.reason;
    if (!same) { mismatches++; console.log(`FAIL P7 device-parity ${row.r}/${row.shape}/${row.f} — web ${a.rel}/${a.reason} vs android ${b?.rel}/${b?.reason}`); }
  }
  n++;
  if (mismatches) fail++;
  ok("P7 device parity across the whole grid", mismatches === 0, `${mismatches} mismatched cells`);
}

// ── the named fixtures: the reported defect, and its mirror ────────────────
//
// The grid proves properties. These prove the two specific timings the owner
// and the browser measured, so a future reader can see the actual numbers move.
{
  // THE REPORT. "U can call me", he starts typing two seconds later. Before
  // WS-BREATH the policy fired at 1300ms — 700ms before his hand arrived.
  const g = drive({ his: [{ at: 0, text: "U can call me" }], compose: composer(FOLLOWERS.find((x) => x.id === "types@2s"), "web") });
  ok("REPORT: he starts typing at 2s and she has not spoken", g.rel > 2_000, JSON.stringify(g));
  ok("REPORT: and she holds through the whole message he types", g.rel > 4_000, JSON.stringify(g));
  console.log(`      the reported cell: complete sentence + typing from 2.0s → she waits ${(g.rel / 1000).toFixed(2)}s (was 1.30s)`);
}
{
  // THE MIRROR. Nothing at all after a complete sentence: she must NOT have
  // become slow. Patience that is charged when nobody is there is dead air.
  const g = drive({ his: [{ at: 0, text: "U can call me" }], compose: composer(FOLLOWERS.find((x) => x.id === "nothing"), "web") });
  ok("MIRROR: an unattended message is answered at the floor and no later", g.rel <= BURST_GRACE_FLOOR_MS + RECHECK_SLOP, JSON.stringify(g));
  console.log(`      the mirror cell:   complete sentence + nothing at all     → she waits ${(g.rel / 1000).toFixed(2)}s (was 1.30s)`);
}
{
  // THE CLIFF. Six characters typed and left. The shipped hold charged the
  // full ten-second abandon budget for this and measured 13.31s of silence.
  const g = drive({ his: [{ at: 0, text: "U can call me" }], compose: composer(FOLLOWERS.find((x) => x.id === "typed@0.5s-then-paused"), "web") });
  ok("CLIFF: a six-character draft no longer buys a paragraph's patience", g.rel < 8_000, JSON.stringify(g));
  console.log(`      the cliff cell:    six characters, then he stops         → she waits ${(g.rel / 1000).toFixed(2)}s (was 13.31s felt)`);
}
{
  // THE FOCUS HOLE. Keyboard up, box empty, not one key pressed — measured at
  // 2.13s before WS-BREATH, identical to a phone lying face-down.
  const g = drive({ his: [{ at: 0, text: "U can call me" }], compose: composer(FOLLOWERS.find((x) => x.id === "focus@1.5s-idle"), "android") });
  ok("FOCUS: an open keyboard over an empty box is a hold", g.rel > BURST_GRACE_FLOOR_MS, JSON.stringify(g));
  ok("FOCUS: and it ends — she is never stuck behind a keyboard", g.rel <= 1_500 + FOCUS_HOLD_MS + RECHECK_SLOP, JSON.stringify(g));
  console.log(`      the focus cell:    keyboard up at 1.5s, zero keystrokes  → she waits ${(g.rel / 1000).toFixed(2)}s (was 2.13s felt)`);
}
{
  // He reaches for the box and puts the phone down without typing. The settle
  // beat, and then she takes the floor — not a cliff at either end.
  const g = drive({ his: [{ at: 0, text: "U can call me" }], compose: composer(FOLLOWERS.find((x) => x.id === "focus@1s-then-leaves@2.5s"), "web") });
  ok("SETTLE: leaving the box does not hand her the floor on the same instant", g.rel >= 2_500, JSON.stringify(g));
  ok("SETTLE: and it is a beat, not a wait", g.rel <= 2_500 + SETTLE_MS + RECHECK_SLOP + 1_000, JSON.stringify(g));
}

// ── the multi-message shapes, on the same clock ────────────────────────────
{
  // Two messages in different directions. The point of this one is not the
  // timing — it is that BOTH reach her as one turn with one reply, which is
  // what `unansweredTail` feeds the compiler. The timing assertion is that the
  // second message re-arms the breath rather than being answered late.
  const g = drive({
    his: [
      { at: 0, text: "kal ka plan cancel ho gaya" },
      { at: 1_800, text: "waise tumne wo movie dekhi?" },
    ],
    compose: composer({ engageAt: null }, "web"),
  });
  ok("MULTI: two directions, one reply, measured from the SECOND message", g.rel > 0 && g.rel !== Infinity, JSON.stringify(g));
  // the last message is a question aimed at her, so the burst ends on a handoff
  ok("MULTI: a burst that ends on a question aimed at her is answered promptly",
    g.rel <= BURST_HANDOFF_MS + RECHECK_SLOP, JSON.stringify(g));
  const tail = unansweredTail([
    { from: "her", at: T0 - 60_000, text: "haan bolo", kind: "text" },
    { from: "me", at: T0, text: "kal ka plan cancel ho gaya", kind: "text" },
    { from: "me", at: T0 + 1_800, text: "waise tumne wo movie dekhi?", kind: "text" },
  ]);
  ok("MULTI: both directions are in the tail the compiler reads", tail.texts.length === 2, JSON.stringify(tail.texts));
  ok("MULTI: oldest first, so the reply reads the way the thread reads",
    tail.texts[0].includes("plan cancel") && tail.texts[1].includes("movie"), JSON.stringify(tail.texts));
}
{
  // Same direction twice — the ordinary burst. Must still be one reply, and
  // must not be answered faster than one message would be.
  const g = drive({
    his: [
      { at: 0, text: "kal ka plan cancel ho gaya" },
      { at: 1_800, text: "ab weekend khali hai" },
    ],
    compose: composer({ engageAt: null }, "web"),
  });
  ok("MULTI: same-direction pair is answered on the breath, from the last one",
    g.rel >= BURST_GRACE_FLOOR_MS && g.rel <= BURST_GRACE_FLOOR_MS + RECHECK_SLOP, JSON.stringify(g));
}

console.log(`\n${cells} grid cells swept (${RHYTHMS.length} rhythms × ${SHAPES.length} shapes × ${FOLLOWERS.length} followers × 2 devices)`);
if (cut.length) console.log(`CUT OFF in ${cut.length} cells: ${cut.slice(0, 8).join(", ")}`);
console.log(fail ? `${fail} FAILURES of ${n}` : `ALL ${n} PASS`);
process.exit(fail ? 1 : 0);
