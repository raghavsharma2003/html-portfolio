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
  isLoopingLine, loopWords, jaccard,
  LOOP_JACCARD, LOOP_LOOKBACK, LOOP_MIN_WORDS, LOOP_MAX_RETRIES, LOOP_NUDGE,
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


// ══ THE HER-SIDE LOOP FENCE (WS-GAMEFEEL) ═════════════════════════════════
//
// A different repetition from everything above. That one is about TOPICS —
// what she keeps bringing up and how he answers. This is about a LINE: the
// 2026-08-25 tester heard "kya idea hai" for a whole game, and same-question
// loops on calls generally. The topic detector structurally cannot see it (the
// tokens are short, shared or both), and nothing else in the stack looked at
// her own previous turn at all.
{
  const line = "arre wahi toh main keh rahi thi na yaar";
  ok("an exact repeat is caught", isLoopingLine(line, [line]));
  ok("…and so is the same line with the filler shuffled",
    isLoopingLine("wahi toh main keh rahi thi na yaar arre", [line]));
  ok("a different line is not", !isLoopingLine("acha ab tum batao kya kar rahe ho", [line]));

  // THE BACKCHANNEL EXEMPTION, which is not a corner case — it is most of what
  // she says on a call. Real people say "hmm" twice in a row and nobody
  // notices; a fence that forced variety there would be the tell, not the fix.
  ok("a short backchannel may repeat", !isLoopingLine("haan haan", ["haan haan"]));
  ok("…and the boundary is LOOP_MIN_WORDS",
    loopWords("haan haan").size < LOOP_MIN_WORDS && loopWords(line).size >= LOOP_MIN_WORDS);

  // THE LOOKBACK IS BOUNDED. Reaching further back turns a deliberate callback
  // ("like I said —") into a defect.
  const older = ["something else entirely here", "another different line here", line];
  ok(`only the last ${LOOP_LOOKBACK} turns count`, !isLoopingLine(line, older));
  ok("…and the most recent one does", isLoopingLine(line, [line, "unrelated words in here"]));

  // NORMALISATION: punctuation, emoji and case are not differences.
  ok("emoji and punctuation are stripped",
    jaccard(loopWords("kya idea hai?? 😭"), loopWords("KYA idea, hai")) === 1);
  ok("devanagari survives normalisation", loopWords("क्या idea है").has("idea"));

  // NEGATIVE CONTROLS — `bold-eats-words`: an assertion whose evidence is an
  // absence passes just as happily on a dead detector.
  ok("NEGATIVE CONTROL: nothing to compare against is never a loop", !isLoopingLine(line, []));
  ok("NEGATIVE CONTROL: an empty candidate is never a loop", !isLoopingLine("", [line]));
  ok("NEGATIVE CONTROL: the threshold can be missed",
    jaccard(loopWords("toh kya idea hai tumhara"), loopWords("kya idea hai tumhara batao")) <= LOOP_JACCARD);

  // THE NUDGE. It says WHAT to do and never WHAT TO SAY: a nudge carrying an
  // example line is a phrase bank, which is `recited-prompt`, installed at
  // exactly the moment she has demonstrated she will repeat what is in front
  // of her.
  ok("the nudge is a <context: …> note", LOOP_NUDGE.startsWith("<context:") && LOOP_NUDGE.endsWith(">"));
  ok("the nudge has NO square brackets", !/[[\]]/.test(LOOP_NUDGE), LOOP_NUDGE);
  ok("the nudge forbids referencing itself", /never reference this note/.test(LOOP_NUDGE));
  ok("the nudge carries no line she could say", !/["\u201c\u2018]/.test(LOOP_NUDGE), LOOP_NUDGE);
  ok("the retry is bounded to one", LOOP_MAX_RETRIES === 1);
}

// ── the SENDER exists — `dead-writers`, structurally ───────────────────────
// A detector with no caller is indistinguishable from an absent one, and four
// of this repo's most expensive findings are that shape. Read off the real
// call lane rather than trusted.
{
  const { readFileSync } = await import("node:fs");
  const call = readFileSync(new URL("../src/components/useCallEngine.ts", import.meta.url), "utf8");
  ok("the cascade lane imports the detector", /isLoopingLine/.test(call));
  ok("…and reads her own previous spoken turns", /function herRecentCallLines/.test(call));
  ok("…on the reply path", /if \(isLoopingLine\(herLine, herBefore\)\) \{/.test(call));
  ok("…and on the silence nudge", /lane: "reengage"/.test(call));
  ok("the retry is bounded by the exported constant", /< LOOP_MAX_RETRIES/.test(call));
  ok("the nudge reaches think() rather than a compile", /\\n\$\{LOOP_NUDGE\}/.test(call));
  ok("liveCall.ts is untouched — its import law is absolute",
    !/isLoopingLine|LOOP_NUDGE/.test(readFileSync(new URL("../src/voice/liveCall.ts", import.meta.url), "utf8")));
}

console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);
