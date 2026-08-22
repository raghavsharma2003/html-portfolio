// The burst policy (src/engine/burst.ts), against the CURRENT source
// (bundled by evals/run.mjs — run that, not this file directly).
//
// The reason this suite exists rather than a couple of inline asserts is the
// asymmetry the owner's own report describes: a wait that is too SHORT is loud
// (she answers mid-thought and it reads as not listening) and a wait that is
// too LONG is silent (it just feels slow, and nobody files that as a bug).
// The clamps are the whole safety story, so both of them get a case, and so
// does every rule about which gaps count as evidence.
//
// Four sections, in order of how expensive the failure is:
//   1. the wait itself, and which gaps count as evidence  (the original suite)
//   2. `likelyMore` — forty labelled Hinglish/English cases, negatives first
//   3. `burstDecide` — the hold, the continuation, the interjection
//   4. LIVENESS, driven adversarially: a hostile signal generator that tries
//      to stall her forever, and cannot.
import {
  burstWaitMs,
  recentUserGaps,
  burstDecide,
  likelyMore,
  unansweredTail,
  BURST_DEFAULT_MS,
  BURST_MIN_MS,
  BURST_MAX_MS,
  BURST_CONT_MAX_MS,
  BURST_INTERJECT_MS,
  CONTINUATION_WEAK_MS,
  CONTINUATION_STRONG_MS,
  COMPOSE_ACTIVE_MS,
  COMPOSE_ABANDON_MS,
} from "./.bundle.mjs";

let fail = 0;
let n = 0;
const check = (name, got, want) => {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};
const ok = (name, cond, extra = "") => {
  n++;
  if (!cond) { fail++; console.log(`FAIL ${name}${extra ? " — " + extra : ""}`); }
};

// ── 1. the wait itself ─────────────────────────────────────────────────────
// No rhythm yet must behave EXACTLY as the shipped constant did: a person with
// no history must not be a person with a new bug.
check("no samples -> default", burstWaitMs([]), BURST_DEFAULT_MS);
check("one sample is an anecdote -> default", burstWaitMs([900]), BURST_DEFAULT_MS);

// A fast typist: 1.6 x 300 = 480, below the floor, so the floor holds.
check("fast typist clamps to MIN", burstWaitMs([300, 280, 320]), BURST_MIN_MS);
// A deliberate typist: 1.6 x 2600 = 4160, above the ceiling. THIS is the case
// scene-hold-800 was about — without the clamp the slowest person waits longest.
check("deliberate typist clamps to MAX", burstWaitMs([2600, 2500, 2700]), BURST_MAX_MS);
// In band, the multiplier actually acts.
check("mid-band scales by the multiplier", burstWaitMs([1000, 1000]), 1600);
check("mid-band, odd count", burstWaitMs([800, 1000, 1200]), 1600);

// Median, not mean: one long pause inside a burst must not redefine the person.
// mean would be 1400 -> 2240; median is 400 -> clamped to the floor.
check("median resists a single outlier", burstWaitMs([400, 400, 400, 400, 5400]), BURST_MIN_MS);

// ── which gaps count as evidence ───────────────────────────────────────────
const T = (from, at, channel) => ({ from, at, channel });

// Consecutive messages of theirs only.
check(
  "consecutive user messages produce gaps",
  recentUserGaps([T("me", 0), T("me", 1000), T("me", 2200)]),
  [1000, 1200],
);

// A gap that spans HER reply is a conversational turn, not a burst. Folding it
// in would inflate the rhythm with exactly the pauses this must distinguish.
check(
  "a gap spanning her reply is not a burst gap",
  recentUserGaps([T("me", 0), T("her", 500), T("me", 9000)]),
  [],
);

// Beyond the ceiling they are done talking, not mid-burst.
check(
  "a gap over the ceiling is excluded",
  recentUserGaps([T("me", 0), T("me", 60_000)]),
  [],
);

// Spoken timing is a different clock.
check(
  "call turns are excluded",
  recentUserGaps([T("me", 0, "call"), T("me", 800, "call")]),
  [],
);

// Order is newest-last, so the caller reads it the way the transcript reads.
check(
  "gaps come back oldest-first",
  recentUserGaps([T("me", 0), T("me", 100), T("me", 900)]),
  [100, 800],
);

// Zero and negative deltas (clock skew, same-ms sends) must not enter.
check("non-positive gaps are excluded", recentUserGaps([T("me", 500), T("me", 500)]), []);

// ── the end-to-end shape the surface actually calls ────────────────────────
check(
  "a real fast burst -> floor",
  burstWaitMs(recentUserGaps([T("me", 0), T("me", 250), T("me", 500), T("me", 760)])),
  BURST_MIN_MS,
);
check(
  "a transcript with no user burst -> default",
  burstWaitMs(recentUserGaps([T("me", 0), T("her", 400), T("me", 9000), T("her", 9500)])),
  BURST_DEFAULT_MS,
);

// ── 2. likelyMore ──────────────────────────────────────────────────────────
//
// THE NEGATIVES ARE THE POINT and they come first. A false positive here costs
// a second of dead air on an ordinary finished sentence, on every turn that
// happens to end in one of these words — which is a worse product than the
// split burst it is trying to prevent, because it happens far more often.
const more = (text, herLast) => likelyMore({ his: [text], herLast }).strength;

// -- negatives: complete turns that must NOT extend --
const COMPLETE = [
  ["a plain finished sentence", "kal office gaya tha bahut boring tha"],
  ["haan as a complete answer to a yes/no question", "haan", "khana kha liya?"],
  ["nahi as a complete answer", "nahi yaar", "tum aa rahe ho?"],
  ["haan even after an open question", "haan", "kya hua tha?"],
  ["a question is a finished act", "matlab?"],
  ["hello?? is him checking she is there, not an opening", "hello??"],
  ["hey? with one mark is still a check-in", "hey?"],
  ["a hinge word INSIDE the sentence", "so main ghar aa gaya"],
  ["wait used as a verb", "wait for me at the gate"],
  ["listen used as a verb", "listen to this song na"],
  ["a price is not an enumeration", "1000 rupay lag gaye"],
  ["a time is not an enumeration", "8:30 pe milte hai"],
  ["a date is not an enumeration", "2 din baad aa raha hu"],
  ["bhi is a sentence ender in Hinglish", "main bhi"],
  ["abhi is a sentence ender", "aa raha hu abhi"],
  ["waise is a sentence ender", "theek h waise"],
  ["an emoji-only reply is complete", "😂😂"],
  ["a filler with no question of hers before it", "hmm"],
  ["a filler after a YES/NO question of hers", "hmm", "tum aaoge?"],
  ["a long answer to an open question", "kuch nahi bas thoda thak gaya tha", "kya hua?"],
  ["a full stop is a full stop", "chalo phir kal baat karte hai."],
  ["her own greeting is irrelevant to his turn", "kaam kar raha hu", "heyy"],
];
for (const [label, text, herLast] of COMPLETE) {
  ok(`likelyMore NOT: ${label}`, more(text, herLast) === "none", `got ${more(text, herLast)} for "${text}"`);
}

// -- strong: he has announced something and not said it yet --
const STRONG = [
  ["the owner's screenshot: a bare Hello", "Hello"],
  ["stretched hey", "heyyy"],
  ["hi with decoration", "hi!! 🥰"],
  ["oye", "oye"],
  ["namaste", "namaste"],
  ["haan bol", "haan bol"],
  ["bolo na", "bolo na"],
  ["wait alone", "wait"],
  ["ruk", "ruk"],
  ["suno alone", "suno"],
  ["btw alone", "btw"],
  ["ek baat", "ek baat"],
  ["1 sec", "1 sec"],
  ["2 min", "2 min"],
  ["30 seconds", "30 seconds"],
  ["one sec", "one sec"],
  ["enumeration 1)", "1) pehle to office ka issue"],
  ["enumeration 2.", "2. aur ye dusra"],
  ["enumeration a)", "a) ye wala"],
  ["pehli baat", "pehli baat tum sunte nahi ho"],
  ["ek toh", "ek toh traffic tha"],
  ["an enumerated item may itself be a question", "1) tum aa rahe ho?"],
];
for (const [label, text] of STRONG) {
  ok(`likelyMore STRONG: ${label}`, more(text) === "strong", `got ${more(text)} for "${text}"`);
}

// -- weak: the sentence stopped on a hinge or a held breath --
const WEAK = [
  ["trailing aur", "kal office gaya aur"],
  ["trailing so", "i went there so"],
  ["trailing matlab", "wo bola nahi aayega matlab"],
  ["trailing toh", "maine socha tha ki main jaunga toh"],
  ["trailing kyunki", "nahi ja paya kyunki"],
  ["trailing comma", "office me aaj jo hua na,"],
  ["trailing colon", "ye dekh:"],
  ["trailing ellipsis", "pata nahi yaar..."],
  ["trailing dash", "matlab dekh -"],
  ["a filler after an OPEN question of hers", "hmm", "kya hua aaj?"],
  ["arre after an open question", "arre", "kaise ho tum?"],
];
for (const [label, text, herLast] of WEAK) {
  ok(`likelyMore WEAK: ${label}`, more(text, herLast) === "weak", `got ${more(text, herLast)} for "${text}"`);
}

// the bonus is the one attached to the strength, not a third number
check("weak bonus", likelyMore({ his: ["kal gaya aur"] }).bonusMs, CONTINUATION_WEAK_MS);
check("strong bonus", likelyMore({ his: ["Hello"] }).bonusMs, CONTINUATION_STRONG_MS);
// it reads the LAST message of the burst, the one he is looking at
check(
  "the last fragment decides",
  likelyMore({ his: ["hello", "kal ka plan cancel ho gaya"] }).strength,
  "none",
);
check("an empty tail is not a signal", likelyMore({ his: [] }).strength, "none");
check("a whitespace-only message is not a signal", likelyMore({ his: ["   "] }).strength, "none");

// ── unansweredTail ─────────────────────────────────────────────────────────
const M = (from, at, text, extra = {}) => ({ from, at, text, ...extra });
{
  const t = unansweredTail([
    M("me", 100, "old"),
    M("her", 200, "kya hua?"),
    M("me", 1000, "a"),
    M("me", 1400, "b"),
  ]);
  check("tail texts, oldest first", t.texts, ["a", "b"]);
  check("tail firstAt is the OLDEST unanswered", t.firstAt, 1000);
  check("tail lastAt is the newest", t.lastAt, 1400);
  check("tail carries her last line", t.herLast, "kya hua?");
  check("tail counts his messages", t.count, 2);
}
check("nothing waiting -> empty tail", unansweredTail([M("her", 5, "hi")]).firstAt, 0);
check(
  "a call turn ends the tail",
  unansweredTail([M("me", 1, "spoken", { channel: "call" }), M("me", 2, "typed")]).count,
  1,
);
check(
  "a photo counts as waiting but is not read as a cue",
  unansweredTail([M("her", 1, "x"), M("me", 2, "[photo]", { kind: "photo" })]).texts,
  [],
);

// THE STALE-TAIL BUG, caught in the browser and fixed in unansweredTail.
// He said "hi" and left; she never answered; days later he says something new.
// An unbounded walk makes the ancient "hi" the burst's first message, its
// deadline is long past, and burstDecide interjects INSTANTLY — the hold
// collapses to zero on exactly the threads most likely to get a second
// thought, i.e. the reported defect arriving through its own fix.
{
  const old = 1_000_000;
  const t = unansweredTail([
    M("her", old - 10_000, "heyy"),
    M("me", old, "hi"),
    M("me", old + 290_000, "wapas aa gaya"),
  ]);
  check("a stale unanswered message is not part of today's burst", t.count, 1);
  check("...and the clock starts at the NEW message", t.firstAt, old + 290_000);
  check("...and only today's words are the cue", t.texts, ["wapas aa gaya"]);
  const d = burstDecide({
    now: old + 290_000 + 100,
    firstUnansweredAt: t.firstAt,
    lastUserAt: t.lastAt,
    gaps: [],
    his: t.texts,
    herLast: t.herLast,
    draftLength: 0,
    lastKeyAt: 0,
  });
  ok("...so she does NOT interject on the spot", !d.fire && d.reason === "waiting", JSON.stringify(d));
}
{
  // and the bound is the burst-sample ceiling, not a new number: 20s apart is
  // still one burst, 30s apart is not
  const base = 500_000;
  check(
    "20s apart is one burst",
    unansweredTail([M("her", base - 1, "x"), M("me", base, "a"), M("me", base + 20_000, "b")]).count,
    2,
  );
  check(
    "30s apart is two",
    unansweredTail([M("her", base - 1, "x"), M("me", base, "a"), M("me", base + 30_000, "b")]).count,
    1,
  );
}

// ── 3. burstDecide ─────────────────────────────────────────────────────────
const sig = (o) => ({
  now: 10_000,
  firstUnansweredAt: 10_000,
  lastUserAt: 10_000,
  gaps: [],
  his: ["kal office gaya tha"],
  herLast: "",
  draftLength: 0,
  lastKeyAt: 0,
  ...o,
});

// nothing of his is waiting: she is NEVER on a bare timer.
check("nothing waiting never fires", burstDecide(sig({ firstUnansweredAt: 0, lastUserAt: 0 })).fire, false);
check("nothing waiting says so", burstDecide(sig({ firstUnansweredAt: 0, lastUserAt: 0 })).reason, "nothing-waiting");

// the plain case is the old behaviour, to the millisecond
check("no rhythm, no draft -> the shipped default", burstDecide(sig({})).waitMs, BURST_DEFAULT_MS);
check("before the due time she waits", burstDecide(sig({})).fire, false);
check(
  "at the due time she fires",
  burstDecide(sig({ now: 10_000 + BURST_DEFAULT_MS })).fire,
  true,
);
check(
  "and says why",
  burstDecide(sig({ now: 10_000 + BURST_DEFAULT_MS })).reason,
  "due",
);

// continuation extends the wait, and lifts the ceiling with it
check(
  "a greeting fragment extends the wait",
  burstDecide(sig({ his: ["Hello"] })).waitMs,
  BURST_DEFAULT_MS + CONTINUATION_STRONG_MS,
);
ok(
  "a deliberate typist plus a strong signal is capped at the continuation ceiling",
  burstDecide(sig({ his: ["Hello"], gaps: [2600, 2500, 2700] })).waitMs === BURST_CONT_MAX_MS,
);
ok(
  "with no signal the ordinary ceiling still holds",
  burstDecide(sig({ gaps: [2600, 2500, 2700] })).waitMs === BURST_MAX_MS,
);
check(
  "waiting on a signal is labelled as such",
  burstDecide(sig({ his: ["Hello"] })).reason,
  "continuation",
);

// the typing hold. Past the due time, but he is mid-word.
const due = 10_000 + BURST_DEFAULT_MS + 500;
check(
  "an active keystroke holds the reply",
  burstDecide(sig({ now: due, draftLength: 12, lastKeyAt: due - 500 })).fire,
  false,
);
check(
  "and is labelled composing",
  burstDecide(sig({ now: due, draftLength: 12, lastKeyAt: due - 500 })).reason,
  "composing",
);
check(
  "a pause mid-thought still holds",
  burstDecide(sig({ now: due, draftLength: 12, lastKeyAt: due - COMPOSE_ACTIVE_MS - 100 })).reason,
  "draft-paused",
);
check(
  "an ABANDONED draft releases the hold — she never goes silent on a thought she cannot see",
  burstDecide(sig({ now: due, draftLength: 12, lastKeyAt: due - COMPOSE_ABANDON_MS - 1 })).fire,
  true,
);
check(
  "an EMPTY box is not a hold, however recently he typed",
  burstDecide(sig({ now: due, draftLength: 0, lastKeyAt: due - 10 })).fire,
  true,
);
ok(
  "the composing hold rechecks exactly when the keystroke goes stale",
  burstDecide(sig({ now: due, draftLength: 5, lastKeyAt: due - 1_000 })).recheckMs ===
    COMPOSE_ACTIVE_MS - 1_000,
);

// the interjection. She answers what she has and the rest is a follow-up.
check(
  "at the ceiling she fires no matter what",
  burstDecide(sig({ now: 10_000 + BURST_INTERJECT_MS, draftLength: 40, lastKeyAt: 10_000 + BURST_INTERJECT_MS })).fire,
  true,
);
check(
  "and calls it an interjection",
  burstDecide(sig({ now: 10_000 + BURST_INTERJECT_MS, draftLength: 40, lastKeyAt: 10_000 + BURST_INTERJECT_MS })).reason,
  "interject",
);
check(
  "the ceiling is measured from his FIRST unanswered message, not his last",
  burstDecide(sig({
    now: 10_000 + BURST_INTERJECT_MS,
    firstUnansweredAt: 10_000,
    lastUserAt: 10_000 + BURST_INTERJECT_MS - 200,
    his: ["Hello"],
    draftLength: 30,
    lastKeyAt: 10_000 + BURST_INTERJECT_MS,
  })).fire,
  true,
);
ok(
  "no non-firing decision ever sleeps past the ceiling",
  [0, 1_000, 5_000, 12_000, 14_999].every((elapsed) => {
    const d = burstDecide(sig({
      now: 10_000 + elapsed,
      his: ["Hello"],
      gaps: [2600, 2500, 2700],
      draftLength: 20,
      lastKeyAt: 10_000 + elapsed,
    }));
    return d.fire || 10_000 + elapsed + d.recheckMs <= 10_000 + BURST_INTERJECT_MS;
  }),
);
ok("a recheck is never zero", burstDecide(sig({})).recheckMs > 0);

// ── 4. LIVENESS, driven adversarially ──────────────────────────────────────
//
// The property, stated so it can be falsified: from any message of his with no
// reply after it, `burstDecide` returns fire within BURST_INTERJECT_MS, for
// EVERY sequence of signals. The prose version of this lives on the function.
// This is the version that can go red.
//
// The driver is the surface's timer loop, honestly: it sleeps for exactly the
// recheckMs it is handed and asks again. If a hostile signal generator can get
// it to sleep past the deadline, or to spin without advancing, the loop below
// notices and the suite fails.
function driveUntilFire(signals, opts = {}) {
  const t0 = 1_000_000;
  let now = t0;
  let steps = 0;
  for (;;) {
    if (++steps > 500) return { fired: false, ms: now - t0, steps, why: "spun" };
    const d = burstDecide(signals(now, t0));
    if (d.fire) return { fired: true, ms: now - t0, steps, reason: d.reason };
    if (d.recheckMs <= 0) return { fired: false, ms: now - t0, steps, why: "zero recheck" };
    now += d.recheckMs;
    if (now - t0 > BURST_INTERJECT_MS + 60_000) return { fired: false, ms: now - t0, steps, why: "overslept" };
    if (opts.onStep) opts.onStep(now);
  }
}
const bound = (label, signals) => {
  const r = driveUntilFire(signals);
  ok(`LIVENESS: ${label} — fires`, r.fired, JSON.stringify(r));
  ok(
    `LIVENESS: ${label} — within BURST_INTERJECT_MS`,
    r.fired && r.ms <= BURST_INTERJECT_MS,
    JSON.stringify(r),
  );
};

// A draft that is never cleared and a keystroke on every single tick: the
// strongest stall an adversary has, and it is the ordinary case of someone
// writing a long message.
bound("endless typing", (now, t0) => sig({
  now,
  firstUnansweredAt: t0,
  lastUserAt: t0,
  draftLength: 400,
  lastKeyAt: now,
}));

// The draft grows AND every fragment baits `likelyMore` with a fresh strong
// signal, AND he keeps sending, so `lastUserAt` slides forward forever.
bound("likelyMore bait + a sliding lastUserAt + endless typing", (now, t0) => sig({
  now,
  firstUnansweredAt: t0,
  lastUserAt: now - 10,
  gaps: [2600, 2500, 2700],
  his: ["1 sec"],
  draftLength: 999,
  lastKeyAt: now,
}));

// Trickling fragments at exactly the rhythm that maximises the derived wait.
bound("slow deliberate trickle", (now, t0) => sig({
  now,
  firstUnansweredAt: t0,
  lastUserAt: t0 + Math.floor((now - t0) / 2_500) * 2_500,
  gaps: [2400, 2600, 2500],
  his: ["kal office gaya aur"],
  draftLength: 60,
  lastKeyAt: now,
}));

// Six fragments in four seconds, nothing in the box: the fast typist. Must NOT
// take the ceiling — she should answer on rhythm, well inside it.
{
  const r = driveUntilFire((now, t0) => sig({
    now,
    firstUnansweredAt: t0,
    lastUserAt: t0 + Math.min(4_000, Math.floor((now - t0) / 700) * 700),
    gaps: [300, 280, 320],
    his: ["haan theek h"],
    draftLength: 0,
    lastKeyAt: 0,
  }));
  ok("LIVENESS: fast typist fires", r.fired, JSON.stringify(r));
  ok("LIVENESS: fast typist is answered on rhythm, not at the ceiling",
    r.fired && r.reason === "due" && r.ms < BURST_INTERJECT_MS, JSON.stringify(r));
}

// And the plain case still costs what it always cost.
{
  const r = driveUntilFire((now, t0) => sig({ now, firstUnansweredAt: t0, lastUserAt: t0 }));
  ok("LIVENESS: an ordinary single message is answered at the default wait",
    r.fired && r.ms === BURST_DEFAULT_MS, JSON.stringify(r));
}

console.log(fail ? `${fail} FAILURES of ${n}` : `ALL ${n} PASS`);
process.exit(fail ? 1 : 0);
