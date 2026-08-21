// T9 session.clock (src/engine/away.ts), against the CURRENT source.
//
// The owner's first report: he left mid-conversation at night, came back in the
// morning, said something real, and she did not notice. This suite pins the two
// halves of the fix — that a real gap produces facts, and that those facts never
// become a script.
import {
  renderAway, humanGap, partOfDay, crossedNight,
  AWAY_MIN_MS, AWAY_BUDGET,
} from "./.bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) { fail++; console.log(`FAIL ${name}${extra ? " — " + extra : ""}`); }
};

// IST is UTC+5:30. 02:42 UTC = 08:12 IST.
const MORNING = Date.UTC(2026, 7, 21, 2, 42);   // 08:12 IST, Fri
const LAST_NIGHT = Date.UTC(2026, 7, 20, 18, 11); // 23:41 IST, Thu
const OVERNIGHT_GAP = MORNING - LAST_NIGHT;       // 8h31m across the night

// ── the owner's exact scenario ─────────────────────────────────────────────
const overnight = renderAway(MORNING, OVERNIGHT_GAP);
ok("overnight renders", overnight.length > 0);
ok("overnight says it covered the night", overnight.includes("gap covered the night"), overnight);
ok("overnight carries the gap length", overnight.includes("8h 31m"), overnight);
ok("overnight knows it is morning now", overnight.includes("(morning)"), overnight);
ok("overnight knows they left at night", overnight.includes("(night)"), overnight);
ok("overnight flags the date change", overnight.includes("different day"), overnight);

// ── silence is the common case and must stay byte-identical ────────────────
ok("a live conversation renders nothing", renderAway(MORNING, 60_000) === "");
ok("just under the floor renders nothing", renderAway(MORNING, AWAY_MIN_MS - 1) === "");
ok("at the floor renders something", renderAway(MORNING, AWAY_MIN_MS).length > 0);

// ── determinism: compile() must stay a pure function of its input ──────────
// If nowMs were ever read from the clock inside compile(), the double-compile
// byte-identity gate would flap on a minute rollover. Absent nowMs => nothing.
ok("undefined nowMs renders nothing", renderAway(undefined, OVERNIGHT_GAP) === "");
ok("NaN nowMs renders nothing", renderAway(NaN, OVERNIGHT_GAP) === "");
ok("NaN gap renders nothing", renderAway(MORNING, NaN) === "");
ok("negative gap renders nothing", renderAway(MORNING, -5) === "");
ok(
  "same input twice is byte-identical",
  renderAway(MORNING, OVERNIGHT_GAP) === renderAway(MORNING, OVERNIGHT_GAP),
);

// ── a daytime gap is long but not a night ──────────────────────────────────
const AFTERNOON = Date.UTC(2026, 7, 21, 9, 30);  // 15:00 IST
const daytime = renderAway(AFTERNOON, 3 * 3_600_000); // since 12:00 IST
ok("a daytime gap does not claim the night", !daytime.includes("covered the night"), daytime);
ok("a same-day gap does not claim a new day", !daytime.includes("different day"), daytime);

// ── the budget is a promise to the manifest ────────────────────────────────
ok("budget respected on the long case", renderAway(MORNING, 9 * 86_400_000).length <= AWAY_BUDGET);
ok("budget respected on the owner's case", overnight.length <= AWAY_BUDGET);

// ── NEGATIVE CONTROL: facts, never a script ────────────────────────────────
// `recited-prompt` is the most expensive law in this repo — her example quotes
// were recited on 4 of 5 turns. If a greeting she could say ever appears in
// this block, she will say it verbatim, every morning, forever.
const SCRIPT_WORDS = [
  "good morning", "gm ", "subah", "so gaya", "so gayi",
  "kaha the", "kahan the", "miss you", "uth gaya", "sorry",
];
for (const w of SCRIPT_WORDS) {
  ok(`no script word: "${w.trim()}"`, !overnight.toLowerCase().includes(w));
}
// No quoted DIALOGUE — a quoted fragment is a phrase bank. Apostrophes inside
// the instruction sentence are not that, so the class is double quotes only.
// (This assertion fired on "doesn't" first time round, which is the control
// doing its job on itself: an over-broad rule is as wrong as an absent one.)
ok("no quoted fragment", !/["“”]/.test(overnight), overnight);

// ── helpers ────────────────────────────────────────────────────────────────
ok("humanGap minutes", humanGap(45 * 60_000) === "45m", humanGap(45 * 60_000));
ok("humanGap hours only", humanGap(3 * 3_600_000) === "3h", humanGap(3 * 3_600_000));
ok("humanGap h+m", humanGap(8 * 3_600_000 + 31 * 60_000) === "8h 31m");
ok("humanGap days", humanGap(3 * 86_400_000) === "3 days", humanGap(3 * 86_400_000));

ok("partOfDay late night", partOfDay(3) === "late night");
ok("partOfDay morning", partOfDay(8) === "morning");
ok("partOfDay afternoon", partOfDay(15) === "afternoon");
ok("partOfDay evening", partOfDay(19) === "evening");
ok("partOfDay night", partOfDay(23) === "night");

ok("crossedNight true across the small hours", crossedNight(MORNING, OVERNIGHT_GAP));
ok("crossedNight false in the afternoon", !crossedNight(AFTERNOON, 3 * 3_600_000));
ok("crossedNight false on a zero gap", !crossedNight(MORNING, 0));
// A multi-day gap must contain a night no matter where it starts.
ok("crossedNight true over 3 days", crossedNight(AFTERNOON, 3 * 86_400_000));

console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);
