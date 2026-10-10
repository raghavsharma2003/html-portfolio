// Offline input/contract checks only; run --live --compare for SQL evidence.
import assert from "node:assert/strict";
import { approvedMirrorRecall, mirrorRecallQueryTerms } from "../../api/_experience-compiler/mirror-recall.js";
assert.deepEqual(mirrorRecallQueryTerms("What is the spectrometer deadline?"), ["spectrometer", "deadline"]);
assert.deepEqual(mirrorRecallQueryTerms("अंशांकन की अंतिम तिथि क्या है?"), ["अंशांकन", "अंतिम", "तिथि"]);
assert.deepEqual(mirrorRecallQueryTerms("what is the क्या है"), []);
assert.equal(mirrorRecallQueryTerms(Array.from({length: 50}, (_, i) => `word${i}`).join(" ")).length, 24);
assert.deepEqual(mirrorRecallQueryTerms(null), []);
assert.deepEqual(mirrorRecallQueryTerms("deadline deadline"), ["deadline"]);
const capture = async options => {
  let call;
  await approvedMirrorRecall(async (sql, params) => { call = { sql, params }; return []; }, "owner", "replica", options);
  return call;
};
const plain = await capture(undefined);
assert.deepEqual(await capture({query: "spectrometer"}), plain, "query alone cannot activate experimental rank");
assert.deepEqual(await capture({strategy: "lexical-shadow", query: ""}), plain);
const query = "spectrometer'); drop table x; --";
const ranked = await capture({strategy: "lexical-shadow", query});
assert.equal(ranked.params.length, 4);
assert.ok(!ranked.sql.includes(query), "raw input must remain a parameter");
assert.match(ranked.sql, /unnest\(\$4::text\[\]\)/);
assert.match(ranked.sql, /plainto_tsquery/);
assert.match(ranked.sql, /limit 8/);
console.log("query contract: input bounds, explicit opt-in and parameterization checked offline; SQL behavior not claimed");
