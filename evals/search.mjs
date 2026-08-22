// How often she may actually look something up (src/engine/brain.ts).
//
// The owner widened the trigger from DOUBT to CURIOSITY — "if the idea or Convo
// is unique and out of scope then ... it should be worth searching". That is
// the right instinct and it also means the marker can now fire on turns the old
// fact-check rule never touched, so the frequency is capped in CODE rather than
// asked for in the brief (`gate0-structural`: a sentence is a preference, a
// predicate is a guarantee).
//
// Every search costs a holding bubble, ~3-4s of the turn, and real money on a
// lane that has run dry twice this week.
import {
  takeSearchSlot, _resetSearchBucket, SEARCH_BUCKET,
  takeExplicitSearchSlot, _resetExplicitSearchBucket, EXPLICIT_SEARCH_BUCKET,
  RE_EXPLICIT_SEARCH,
} from "./.bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) { fail++; console.log(`FAIL ${name}${extra ? " — " + extra : ""}`); }
};

_resetSearchBucket();

// Back-to-back factual questions must BOTH still be answered. That is the case
// the old trigger served and it must not regress — which is why this is a
// bucket and not a fixed gap between searches.
const first = [];
for (let i = 0; i < SEARCH_BUCKET; i++) first.push(takeSearchSlot());
ok(`the first ${SEARCH_BUCKET} in a row all run`, first.every(Boolean), JSON.stringify(first));

// ...and then it settles down rather than searching every turn forever.
ok("the next one is capped", takeSearchSlot() === false);
ok("and it stays capped", takeSearchSlot() === false);

// The reset seam actually resets, or every assertion above is order-dependent.
_resetSearchBucket();
ok("a drained bucket allows again", takeSearchSlot() === true);

// A capped search must behave like a FAILED one, not like a dropped promise.
// That is asserted at the call site in brain.ts (ok stays false, facts stays
// empty, and the second pass already says "couldn't check right now") — this
// suite pins the predicate; the honest-degradation half is covered by the
// existing search-failure path it reuses.

// ── the explicit ask (owner report: told her to search Westside, twice,
// and she insisted he explain instead) ─────────────────────────────────
// A direct instruction bypasses the curiosity bucket: refusal-by-budget on
// an explicit ask is the defect this lane exists to prevent. Its own bucket
// is larger but still real — "search X" pasted in a loop is a cost bug.
_resetSearchBucket();
_resetExplicitSearchBucket();
for (let i = 0; i < SEARCH_BUCKET; i++) takeSearchSlot();
ok("curiosity drained does not block an explicit ask", takeExplicitSearchSlot() === true);
_resetExplicitSearchBucket();
const exp = [];
for (let i = 0; i < EXPLICIT_SEARCH_BUCKET; i++) exp.push(takeExplicitSearchSlot());
ok(`the explicit lane allows ${EXPLICIT_SEARCH_BUCKET} in a row`, exp.every(Boolean));
ok("and even the explicit lane eventually caps", takeExplicitSearchSlot() === false);
ok("explicit bucket is meaningfully larger", EXPLICIT_SEARCH_BUCKET >= SEARCH_BUCKET * 3);

// the detector: his words that ARE a search instruction
for (const t of [
  "search kar na iske baare me",
  "google it",
  "go and search about it",
  "search about westside",
  "net pe dekh le",
  "check na google pe",
  "look it up yaar",
  "google kar ke bata",
]) ok(`explicit ask detected: "${t}"`, RE_EXPLICIT_SEARCH.test(t), t);
// ...and his words that are NOT
for (const t of [
  "i was searching for my keys all morning",
  "researchers say chai is good",
  "main westside gaya tha aaj",
  "kal google office ke paas tha",
  "dekh na kya scene h",
  "check this out",
]) ok(`not an ask: "${t}"`, !RE_EXPLICIT_SEARCH.test(t), t);

// the decision rule carries the clause (position law: the block is appended
// last; this pins that the explicit-ask sentence exists inside it)
import { readFileSync } from "node:fs";
const persona = readFileSync(new URL("../src/engine/persona.ts", import.meta.url), "utf8");
const sd = persona.slice(persona.indexOf("SEARCH_DECISION"));
ok("SEARCH_DECISION names the direct ask", /If they TELL you to look something up/.test(sd));
ok("SEARCH_DECISION names the unplaceable NAME", /A NAME they drop that you cannot actually place/.test(sd));
ok("brain routes explicit asks to the explicit bucket",
  /explicitAsk \? takeExplicitSearchSlot\(\) : takeSearchSlot\(\)/.test(
    readFileSync(new URL("../src/engine/brain.ts", import.meta.url), "utf8")));

console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);
