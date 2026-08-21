// T14 rel.raised (src/engine/repeat.ts), against the CURRENT source.
//
// The owner reported this twice — "she keep repeating same thing again n again"
// and "just keep repeating the things … not interesting at all" — and asked for
// it to be TONED DOWN and modulated on his own behaviour, not switched off. So
// the suite pins three things: that repetition is seen, that his reception is
// carried alongside it, and that nothing she could recite ever enters the block.
import {
  raisedRecently, renderRaised,
  MIN_TIMES, MAX_TERMS, RAISED_BUDGET, SHORT_REPLY_WORDS,
} from "./.bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) { fail++; console.log(`FAIL ${name}${extra ? " — " + extra : ""}`); }
};
const her = (text) => ({ from: "her", text });
const me = (text) => ({ from: "me", text });

// ── she raises the same thing three times and he barely answers ────────────
const nagging = [
  her("gym gaya tha aaj"), me("nahi"),
  her("acha gym ka kya scene"), me("hmm"),
  her("gym join kiya kya finally"), me("nope"),
  her("kal kya plan hai"), me("kuch nahi yaar bas ghar pe hu aaram kar raha"),
];
const rows = raisedRecently(nagging);
const gym = rows.find((r) => r.term === "gym");
ok("the repeated term is found", !!gym, JSON.stringify(rows));
ok("it counts every time she raised it", gym && gym.times === 3, JSON.stringify(gym));
ok("his replies are measured as short", gym && gym.theirWords <= SHORT_REPLY_WORDS, JSON.stringify(gym));

const nagText = renderRaised(rows);
ok("a repeated topic renders", nagText.includes("gym"), nagText);
ok("the count reaches her", nagText.includes("3x"), nagText);
ok("his short reception reaches her", nagText.includes("answered short"), nagText);

// ── the same repetition, but he ENGAGES: the signal must flip ──────────────
const engaged = [
  her("gym gaya tha aaj"), me("haan yaar subah gaya tha leg day tha bohot dard ho raha hai ab"),
  her("acha gym ka kya scene"), me("ab roz jaa raha hu trainer ne diet bhi likh ke di hai dekhte hai"),
  her("gym join kiya kya finally"), me("haan kal hi membership li six months ki ekdum sahi deal mili"),
];
const eRows = raisedRecently(engaged);
const eGym = eRows.find((r) => r.term === "gym");
ok("engagement is measured, not just count", eGym && eGym.theirWords > SHORT_REPLY_WORDS, JSON.stringify(eGym));
ok("engaged reception renders differently", renderRaised(eRows).includes("they engaged"), renderRaised(eRows));

// ── the thing he asked NOT to happen: never a ban ──────────────────────────
// Same topic, same count, opposite reception => opposite advice. If the block
// ever said "stop mentioning gym" this assertion is the one that catches it.
ok("no ban language", !/stop|don't|do not|never mention|avoid/i.test(nagText), nagText);
ok("the decision is left to her", /you decide/i.test(nagText), nagText);

// ── raised once is not repetition ──────────────────────────────────────────
const once = [her("gym gaya tha"), me("acha"), her("khana khaya"), me("haan")];
ok("a single mention is not repetition", !raisedRecently(once).some((r) => r.term === "gym"));
ok("nothing repeated renders nothing", renderRaised(raisedRecently(once)) === "");
ok("an empty transcript renders nothing", renderRaised(raisedRecently([])) === "");
ok("a two-turn transcript renders nothing", renderRaised(raisedRecently([her("a"), me("b")])) === "");

// ── the stoplist that isn't a stoplist ─────────────────────────────────────
// A word carried by most messages is structural for THIS pair and must not be
// reported as a topic. Measured from the transcript, so it works in Hinglish
// without a list to go stale (`observation.ts` refused to duplicate RECALL_STOP).
const filler = [
  her("yaar kya kar raha hai"), me("yaar kuch nahi"),
  her("yaar batao na"), me("yaar bas timepass"),
  her("yaar sun na"), me("yaar bolo"),
];
ok(
  "a word in most messages is not a topic",
  !raisedRecently(filler).some((r) => r.term === "yaar"),
  JSON.stringify(raisedRecently(filler)),
);

// ── call turns are a different clock ───────────────────────────────────────
const spoken = [
  { from: "her", text: "gym gaya tha", channel: "call" }, { from: "me", text: "haan", channel: "call" },
  { from: "her", text: "gym ka scene", channel: "call" }, { from: "me", text: "hmm", channel: "call" },
  { from: "her", text: "gym join kiya", channel: "call" }, { from: "me", text: "nope", channel: "call" },
];
ok("call turns are excluded", raisedRecently(spoken).length === 0, JSON.stringify(raisedRecently(spoken)));

// ── caps and budget ────────────────────────────────────────────────────────
const many = [];
for (const t of ["alpha", "bravo", "charlie", "delta", "echo"]) {
  for (let i = 0; i < 3; i++) { many.push(her(`${t} ${t}bat ${i}`)); many.push(me("hmm")); }
}
const manyRows = raisedRecently(many);
ok(`at most ${MAX_TERMS} terms`, manyRows.length <= MAX_TERMS, String(manyRows.length));
ok("budget respected", renderRaised(manyRows).length <= RAISED_BUDGET);
ok("most-repeated first", manyRows.every((r, i) => i === 0 || manyRows[i - 1].times >= r.times));

// ── NEGATIVE CONTROL: terms travel, sentences never do ─────────────────────
// `recited-prompt`: echoing her own repeated SENTENCES back into her brief is
// exactly the phrase bank that produced 4-of-5 verbatim recitation. Only bare
// tokens may cross, so no multi-word fragment of her text may appear.
const HER_FRAGMENTS = ["gym gaya tha aaj", "gym ka kya scene", "gym join kiya kya finally"];
for (const frag of HER_FRAGMENTS) {
  ok(`no sentence fragment: "${frag}"`, !nagText.includes(frag), nagText);
}
ok("every reported term is a single token", rows.every((r) => !/\s/.test(r.term)), JSON.stringify(rows));
ok("no quoted dialogue", !/["“”]/.test(nagText), nagText);

// ── determinism ────────────────────────────────────────────────────────────
ok("same input twice is byte-identical", renderRaised(raisedRecently(nagging)) === nagText);

console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);
