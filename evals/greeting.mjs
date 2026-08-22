// GREET ONCE (src/engine/greeting.ts) + the burst's shape on the wire
// (brain.ts's toTurns), against the CURRENT source — run via evals/run.mjs.
//
// The reported defect, verbatim in shape: she opened "heyyy", he answered
// "Hello", she came back "hey …", he said "Esse hi timepass", she came back
// "heyy …". Three hellos in one unbroken conversation.
//
// The NEGATIVES are what make this shippable and they are checked first and
// hardest, because every one of them is a way this predicate could quietly
// make her worse than the bug it fixes:
//   - her FIRST message of a sitting must greet, or she becomes cold;
//   - a new sitting must greet fresh, or the come-back beat in the brief (the
//     loud unguarded hello) is silently deleted from the product;
//   - "hello?? tum ho na" is her checking whether he is there, and stripping
//     the hello turns a worried nudge into a non sequitur;
//   - a greeting mid-sentence is a discourse particle and is hers to keep;
//   - and it must NEVER produce an empty reply.
import {
  leadingGreeting,
  isGreetingOnly,
  sittingStartAt,
  sheGreetedThisSitting,
  greetOnce,
  SITTING_GAP_MS,
  toTurns,
} from "./.bundle.mjs";

let fail = 0;
let n = 0;
const ok = (name, cond, extra = "") => {
  n++;
  if (!cond) { fail++; console.log(`FAIL ${name}${extra ? " — " + extra : ""}`); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// ── what counts as a greeting ──────────────────────────────────────────────
const GREETS = [
  "hey", "heyy", "heyyy", "hey there", "heya", "hi", "hii", "hiii", "hello",
  "hellooo", "helo", "hlo", "hola", "yo", "oye", "oyee", "namaste", "namaskar",
  "sup", "gm", "good morning", "good evening", "morning",
];
for (const g of GREETS) ok(`greeting: "${g}"`, isGreetingOnly(g), JSON.stringify(leadingGreeting(g)));
// decoration is not content
ok("greeting with emoji", isGreetingOnly("heyy 🥰"));
ok("greeting with punctuation", isGreetingOnly("hi!!"));
ok("greeting with a vocative", isGreetingOnly("hey yaar"));
ok("two greetings in a row", isGreetingOnly("hey hi"));

// -- not greetings --
const NOT = [
  ["a greeting mid-sentence stays put", "chal hey listen"],
  ["the Hindi emphatic hi", "hi toh maine bola tha"],
  ["hi as a particle before hai", "hi hai na wo"],
  ["morning as a subject", "morning walk pe gayi thi"],
  ["a sentence that merely starts with h", "haan bilkul"],
  ["her own content", "kya kar rahe ho"],
  ["an emoji", "😭"],
  ["empty", ""],
];
for (const [label, text] of NOT) ok(`not a greeting: ${label}`, !isGreetingOnly(text), JSON.stringify(leadingGreeting(text)));

// -- the check-in, which is a greeting SHAPE doing a different job --
for (const t of ["hello??", "hey?", "hello?? tum ho na", "hi? sun rahe ho"]) {
  ok(`check-in flagged: "${t}"`, leadingGreeting(t)?.checkIn === true, JSON.stringify(leadingGreeting(t)));
  ok(`check-in is not a greeting-only: "${t}"`, !isGreetingOnly(t));
}

// -- the split, when there IS a rest --
eq("hey + rest", leadingGreeting("heyy kya kar rahe ho")?.rest, "kya kar rahe ho");
eq("hey yaar + rest", leadingGreeting("hey yaar, kal milte hai")?.rest, "kal milte hai");
eq("hello! + rest", leadingGreeting("hello! bahut din ho gaye")?.rest, "bahut din ho gaye");

// ── sittings ───────────────────────────────────────────────────────────────
const NOW = 1_700_000_000_000;
const m = (from, minsAgo, text, extra = {}) => ({ from, at: NOW - minsAgo * 60_000, kind: "text", text, ...extra });

ok("an empty record starts a sitting now", sittingStartAt([], NOW) === NOW);
ok(
  "a live conversation is one sitting",
  sittingStartAt([m("her", 20, "heyy"), m("me", 19, "hi"), m("her", 18, "kya scene")], NOW) === NOW - 20 * 60_000,
);
{
  const rec = [m("her", 600, "heyy"), m("me", 599, "hi"), m("her", 30, "arre tum"), m("me", 29, "haan")];
  ok("a gap over the threshold starts a new sitting", sittingStartAt(rec, NOW) === NOW - 30 * 60_000);
  ok("...so her old hello is not in this sitting", sheGreetedThisSitting(rec, NOW) === false);
}
ok(
  "a record that has itself gone quiet is a fresh sitting",
  sittingStartAt([m("her", 600, "heyy"), m("me", 599, "hi")], NOW) === NOW,
);
ok("SITTING_GAP_MS is four hours", SITTING_GAP_MS === 4 * 3_600_000);
ok(
  "his greetings are irrelevant",
  sheGreetedThisSitting([m("me", 10, "Hello"), m("me", 9, "hey")], NOW) === false,
);
ok(
  "her check-in is not a greeting she has spent",
  sheGreetedThisSitting([m("her", 10, "hello?? tum ho na")], NOW) === false,
);
ok(
  "a call hello does not spend her text hello",
  sheGreetedThisSitting([m("her", 10, "heyy", { channel: "call" })], NOW) === false,
);
ok("her hello counts", sheGreetedThisSitting([m("her", 10, "heyy kya scene")], NOW) === true);

// ── greetOnce ──────────────────────────────────────────────────────────────
//
// THE OWNER'S SEQUENCE, turn by turn. This is the whole ticket.
{
  // turn 1: the chat is brand new, she opens. Nothing to strip.
  const opener = greetOnce(["heyyy"], [], NOW);
  eq("owner seq 1: her opener greets", opener.bubbles, ["heyyy"]);

  // turn 2: he says "Hello". She must not greet back.
  const rec2 = [m("her", 3, "heyyy"), m("me", 2, "Hello")];
  const t2 = greetOnce(["hey", "kya kar rahe ho"], rec2, NOW);
  eq("owner seq 2: the second hello is dropped", t2.bubbles, ["kya kar rahe ho"]);
  ok("owner seq 2: counted as a drop", t2.dropped === 1 && t2.stripped === 0);

  // turn 3: he says "Esse hi timepass". She must not greet a THIRD time.
  const rec3 = [...rec2, m("her", 2, "kya kar rahe ho"), m("me", 1, "Esse hi timepass")];
  const t3 = greetOnce(["heyy bas main bhi free hu"], rec3, NOW);
  eq("owner seq 3: the leading hello is stripped, the sentence survives", t3.bubbles, ["bas main bhi free hu"]);
  ok("owner seq 3: counted as a strip", t3.stripped === 1 && t3.dropped === 0);
}

// -- the negatives --
eq("her first message of a sitting greets", greetOnce(["heyy", "kaise ho"], [m("me", 5, "hi")], NOW).bubbles, ["heyy", "kaise ho"]);
{
  const rec = [m("her", 600, "heyy"), m("me", 1, "hi")];
  eq("a new sitting greets fresh", greetOnce(["heyyy tum!!"], rec, NOW).bubbles, ["heyyy tum!!"]);
}
{
  const rec = [m("her", 10, "heyy"), m("me", 1, "...")];
  eq("her check-in survives", greetOnce(["hello?? tum ho na"], rec, NOW).bubbles, ["hello?? tum ho na"]);
  eq("a mid-sentence greeting survives", greetOnce(["chal hey listen"], rec, NOW).bubbles, ["chal hey listen"]);
  eq("only the FIRST bubble is examined", greetOnce(["accha", "hey wait no"], rec, NOW).bubbles, ["accha", "hey wait no"]);
}
{
  // NEVER an empty reply. Everything she wrote was a hello and she has already
  // said one — a duplicated hello is a blemish, silence is a broken product.
  const rec = [m("her", 10, "heyy"), m("me", 1, "hi")];
  const r = greetOnce(["heyy"], rec, NOW);
  ok("all-greeting reply is never emptied", r.bubbles.length === 1 && r.degraded === true, JSON.stringify(r));
  const r2 = greetOnce(["hey", "hii"], rec, NOW);
  ok("all-greeting multi-bubble is never emptied", r2.bubbles.length >= 1, JSON.stringify(r2));
}
eq("no bubbles in, no bubbles out", greetOnce([], [m("her", 5, "heyy")], NOW).bubbles, []);

// ── the burst reaches the model as ONE turn ────────────────────────────────
//
// This was the third suspect in the report and it turned out to be already
// correct, which is exactly why it needs a test: an un-merged shape would be
// invisible in the product (she would just seem to ignore half a burst) and
// nothing was pinning the merge. Three grey bubbles are ONE thing a person
// read, and they must reach her as one thing.
{
  const H = (from, at, text) => ({ from, at, kind: "text", text, id: String(at) });
  const turns = toTurns(
    [H("me", NOW - 9_000, "hello"), H("me", NOW - 6_000, "sun na"), H("me", NOW - 3_000, "kal ka plan cancel")],
    "kal ka plan cancel",
  );
  ok("a three-message burst is ONE user turn", turns.length === 1 && turns[0].role === "user", JSON.stringify(turns));
  const body = String(turns[0].content);
  ok("every fragment survives the merge", ["hello", "sun na", "kal ka plan cancel"].every((s) => body.includes(s)), body);
  ok("each fragment keeps its own clock stamp", (body.match(/\[\d{1,2}:\d{2}/g) || []).length === 3, body);
  ok("they are newline-separated, the way the thread reads", body.split("\n").length === 3, body);
}
{
  const H = (from, at, text) => ({ from, at, kind: "text", text, id: String(at) });
  // a topic switch mid-burst: both halves must be present, so her reply can
  // address both — the brief already allows 2-3 bubbles for exactly this.
  const turns = toTurns(
    [
      H("me", NOW - 30_000, "yo"),
      H("her", NOW - 20_000, "kya scene"),
      H("me", NOW - 9_000, "kal ka plan cancel ho gaya"),
      H("me", NOW - 4_000, "waise tumne wo series dekhi?"),
    ],
    "waise tumne wo series dekhi?",
  );
  // strict alternation, and the window always OPENS on a user turn — toTurns
  // shifts leading assistant turns off, which is why a her-first history is
  // one turn shorter than it looks.
  eq("alternation is preserved", turns.map((t) => t.role), ["user", "assistant", "user"]);
  const body = String(turns[2].content);
  ok("a topic-switch burst presents BOTH topics", body.includes("plan cancel") && body.includes("series"), body);
}

console.log(fail ? `${fail} FAILURES of ${n}` : `ALL ${n} PASS`);
process.exit(fail ? 1 : 0);
