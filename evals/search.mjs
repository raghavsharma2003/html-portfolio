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
import { takeSearchSlot, _resetSearchBucket, SEARCH_BUCKET } from "./.bundle.mjs";

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

console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);
