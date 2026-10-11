import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { matchesIssuedNonceV2, IDENTITY_NONCE_V2 } from "../api/_voice-identity/nonce-v2.js";

const NONCE = "0 1 2 3 4 5";
let checks = 0;
function check(name, value) { assert.equal(value, true, name); console.log(`ok ${++checks} - ${name}`); }
for (const text of ["012345", "0 1 2 3 4 5", "Code 012345.", "कोड ०१२३४५ है",
  "कोड ० १ २ ३ ४ ५ है", "Code:012345", "Code (012345).", "Code ‘012345’.",
  "0,1,2,3,4,5", "0, 1, 2, 3, 4, 5", "0 , 1 2,3 4 ,5", "0\t1\n2 3\r\n4 5",
  "０１２３４５", "0\u00a01\u00a02\u00a03\u00a04\u00a05", "०1२3४5"]) {
  check(`positive exact token grammar ${JSON.stringify(text)}`, matchesIssuedNonceV2(NONCE, text));
}
for (const text of ["कोड ०१२३४५।", "कोड ०१२३४५॥", "कोड ० १ २ ३ ४ ५।", "कोड ० १ २ ३ ४ ५॥"]) {
  check("Hindi final danda punctuation terminates an exact nonce", matchesIssuedNonceV2(NONCE, text));
}
for (const [name, text] of [
  ["longer number suffix", "0123456"], ["longer number prefix", "9012345"],
  ["extra separated digit", "0 1 2 3 4 5 6"], ["extra prefix digit", "9 0 1 2 3 4 5"],
  ["other numeric token", "I bought 2 cups. Code 012345."], ["repeated nonce", "012345 012345"],
  ["missing digit", "0 1 2 3 4"], ["reordered digits", "0 1 2 3 5 4"],
  ["word-spliced run", "0 apples 1 bus 2 cat 3 dog 4 egg 5"],
  ["two chunks", "012 345"], ["three chunks", "01 23 45"], ["mixed chunk sizes", "0 12 3 4 5"],
  ["decimal", "0.12345"], ["decimal split digits", "0.1.2.3.4.5"],
  ["decimal suffix", "012345.0"], ["decimal prefix", ".012345"],
  ["version", "v0.1.2.3.4.5"], ["date slash", "01/23/45"], ["date hyphen", "0-1-2-3-4-5"],
  ["time separators", "0:1:2:3:4:5"], ["underscore", "0_1_2_3_4_5"],
  ["double commas", "0,,1,2,3,4,5"], ["semicolon run", "0;1;2;3;4;5"],
  ["danda inside run", "०।१।२।३।४।५"], ["double danda inside run", "०॥१॥२॥३॥४॥५"],
  ["Latin prefix", "code012345"], ["Latin suffix", "012345abc"],
  ["Devanagari prefix", "कोड012345"], ["Devanagari suffix", "012345है"],
  ["combining mark prefix", "\u0301012345"], ["combining mark suffix", "012345\u0301"],
  ["zero-width joiner prefix", "\u200d012345"], ["zero-width space suffix", "012345\u200b"],
  ["joiner inside run", "0 1 2\u200d3 4 5"], ["identifier underscore prefix", "_012345"],
  ["invisible BOM prefix", "a\ufeff012345"], ["invisible BOM suffix", "012345\ufeffa"],
  ["invisible BOM separator", "0\ufeff1 2 3 4 5"],
  ["identifier slash suffix", "012345/path"], ["bidi control prefix", "\u202e012345"],
  ["unsupported Arabic digits", "٠١٢٣٤٥"], ["unsupported numeral adjacent", "٠012345"],
  ["English number words", "zero one two three four five"], ["Hindi number words", "शून्य एक दो तीन चार पांच"],
  ["empty", ""], ["whitespace only", "   "], ["over input bound", "a".repeat(4001)],
  ["NFKC expansion over bound", "\ufdfa".repeat(250) + " 012345"],
]) check(`reject ${name}`, !matchesIssuedNonceV2(NONCE, text));
for (const nonce of [undefined, null, 123456, new String(NONCE), "012345", "0 1 2 3", "0 1 2 3 4 5 6",
  "० १ २ ३ ४ ५", "0 1 2 3 4 5\n", "0  1 2 3 4 5", " 0 1 2 3 4 5"]) {
  check("invalid issued nonce fails without coercion", !matchesIssuedNonceV2(nonce, "012345"));
}
for (const text of [null, undefined, 12345, new String("012345"), { toString() { throw Error("must not coerce"); } }]) {
  check("invalid transcript type fails without coercion", !matchesIssuedNonceV2(NONCE, text));
}
check("all-zero issued nonce remains a valid exact sequence", matchesIssuedNonceV2("0 0 0 0 0 0", "Code 000000."));
check("exact input bound accepted", matchesIssuedNonceV2(NONCE, `${"a".repeat(3992)} 012345.`));
check("descriptor is deeply frozen", Object.isFrozen(IDENTITY_NONCE_V2) && Object.isFrozen(IDENTITY_NONCE_V2.recognized_digit_scripts));

// Execute only the actual legacy normalization and nonce source in an isolated
// VM. No heavy identity module, provider config or network is imported. These
// witnesses expose existing unsafe semantics; v1 behavior is not modified.
const legacy = readFileSync(new URL("../api/_replica-voice-identity.js", import.meta.url), "utf8");
const normalization = legacy.slice(legacy.indexOf("const DIGIT_FOLD = ["), legacy.indexOf("export function transcriptOverlap("));
const nonceFunction = legacy.slice(legacy.indexOf("export function nonceSpoken("), legacy.indexOf("export function basisIsContentFree("));
assert.ok(normalization.includes("function foldDigits(") && nonceFunction.includes('.replace(/\\D/g, "").includes(digits)'));
const legacyParser = runInNewContext(`${normalization.replaceAll("export function", "function")}\n${nonceFunction.replaceAll("export function", "function")}\nnonceSpoken`,
  { fail(code) { throw Error(code); } }, { timeout: 1000 });
for (const text of ["90123456", "0 apples 1 bus 2 cat 3 dog 4 egg 5", "0.1.2.3.4.5", "01/23/45", "code012345suffix"]) {
  check("negative control: actual legacy parser admits forbidden digit construction", legacyParser(NONCE, text) && !matchesIssuedNonceV2(NONCE, text));
}
console.log(`\n${checks} nonce v2 checks passed (pure lexical fixtures; no decision, ASR or identity acceptance)`);
