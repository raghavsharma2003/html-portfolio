import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildIssuedVoiceContract, validateIssuedVoiceContract, getIssuedVoiceBank, getIssuedVoiceProfile }
  from "../api/_voice-identity/issued-contract.js";
import { canonicalJson, sha256Hex } from "../api/_replica-processing/contracts.js";

const BASE = { challengeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", replicaId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  ownerUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", locale: "hi-IN", sentenceItemId: "item-1",
  nonce: "0 1 2 3 4 5", referenceGenomeVersion: 2 };
let checks = 0;
const ok = (name) => console.log(`ok ${++checks} - ${name}`);
const clone = (value) => JSON.parse(JSON.stringify(value));
const hashObject = (value) => sha256Hex(canonicalJson(value));
const rejects = (run, name) => { assert.throws(run, (error) => /^identity_issued_[a-z_]+_invalid$/.test(error.code) && error.message === error.code); ok(name); };

for (const locale of ["hi-IN", "en-IN"]) {
  const bank = getIssuedVoiceBank(locale);
  const { sha256, ...descriptor } = bank;
  assert.equal(sha256, hashObject(descriptor));
  assert.equal(bank.owner_reviewed, false); assert.equal(bank.review_status, "unreviewed-draft");
  assert.equal(new Set(bank.items.map((item) => item.id)).size, bank.items.length);
  for (const item of bank.items) {
    assert.ok(item.text.split(" ").length >= 8 && item.text.split(" ").length <= 12);
    assert.ok((locale === "hi-IN" ? /^[\p{Script=Devanagari}\p{M} ]+$/u : /^[A-Za-z ]+$/).test(item.text));
    const result = buildIssuedVoiceContract({ ...BASE, locale, sentenceItemId: item.id });
    assert.deepEqual(validateIssuedVoiceContract(result, result.contractSha256), result);
    assert.equal(result.contract.sentence_hash, sha256Hex(result.sentence));
    assert.equal(result.contract.nonce_sha256, sha256Hex(BASE.nonce));
    assert.equal(result.contract.issued_locale, locale);
    assert.equal(result.contract.sentence_bank_sha256, bank.sha256);
    assert.ok(result.sentence.endsWith(`${locale === "hi-IN" ? "कोड" : "Code"} ${BASE.nonce}.`));
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.contract));
  }
  ok(`${locale}: six exact-script unreviewed items build and validate with nonce and hashes`);
}
const profile = getIssuedVoiceProfile();
const { sha256: profileHash, ...profileDescriptor } = profile;
assert.equal(profileHash, hashObject(profileDescriptor));
assert.equal(profile.servable, false);
assert.ok(Object.values(profile.prerequisites).every((value) => value === false));
assert.equal(profile.decision.implementation_status, "pending");
assert.equal(profile.decision.legacy_nonce_parser, "strips-nondigits-and-substring-matches");
assert.equal(profile.speaker.reference_revision_compatibility, "unproven");
assert.equal(profile.asr.managed_acoustic_model_revision, null);
assert.deepEqual([profile.decision.accept_at_or_above, profile.decision.review_at_or_above,
  profile.decision.transcript_overlap_min, profile.decision.min_reference_windows], [0.78, 0.70, 0.60, 2]);
assert.equal(profile.evidence.transform.parameter_sha256, hashObject(profile.evidence.transform.parameters));
ok("profile commits provisional semantics without serving, bank review or model compatibility claims");
assert.throws(() => { profile.servable = true; }, TypeError);
assert.throws(() => { profile.evidence.transform.parameters.trim = true; }, TypeError);
assert.throws(() => { getIssuedVoiceBank("hi-IN").items[0].text = "changed"; }, TypeError);
ok("registries and nested descriptors cannot be mutated");

const built = buildIssuedVoiceContract(BASE);
const reordered = clone(built);
reordered.contract = Object.fromEntries(Object.entries(reordered.contract).reverse());
assert.equal(hashObject(reordered.contract), built.contractSha256);
assert.deepEqual(validateIssuedVoiceContract(reordered, built.contractSha256), built);
assert.notEqual(validateIssuedVoiceContract(reordered, built.contractSha256), reordered);
ok("key order is canonical and validation returns a fresh frozen value");

for (const [name, patch] of [
  ["challenge", { challengeId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }],
  ["replica", { replicaId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }],
  ["owner", { ownerUserId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }],
  ["locale", { locale: "en-IN" }], ["bank item", { sentenceItemId: "item-2" }],
  ["nonce", { nonce: "9 1 2 3 4 5" }], ["reference", { referenceGenomeVersion: 3 }],
]) {
  const changed = buildIssuedVoiceContract({ ...BASE, ...patch });
  assert.notEqual(changed.contractSha256, built.contractSha256);
  rejects(() => validateIssuedVoiceContract(changed, built.contractSha256), `${name} changes commitment and cannot match persisted issue hash`);
}

for (const [name, patch] of [
  ["upper UUID", { challengeId: BASE.challengeId.toUpperCase() }], ["UUID whitespace", { ownerUserId: ` ${BASE.ownerUserId}` }],
  ["UUID trailing newline", { challengeId: `${BASE.challengeId}\n` }],
  ["UUID object", { replicaId: new String(BASE.replicaId) }], ["UUID invalid variant", { challengeId: "aaaaaaaa-aaaa-4aaa-7aaa-aaaaaaaaaaaa" }],
  ["missing locale", { locale: undefined }], ["auto locale", { locale: "auto" }], ["unknown locale", { locale: "unknown" }],
  ["locale case folding", { locale: "HI-in" }], ["locale string object", { locale: new String("hi-IN") }],
  ["unknown item", { sentenceItemId: "item-7" }], ["numeric item", { sentenceItemId: 1 }],
  ["four digit nonce", { nonce: "1 2 3 4" }], ["seven digit nonce", { nonce: "1 2 3 4 5 6 7" }],
  ["collapsed nonce", { nonce: "123456" }], ["Devanagari issued nonce", { nonce: "१ २ ३ ४ ५ ६" }],
  ["nonce newline", { nonce: "1 2 3 4 5 6\n" }], ["nonce words", { nonce: "one two three four five six" }],
  ["numeric reference string", { referenceGenomeVersion: "2" }], ["zero reference", { referenceGenomeVersion: 0 }],
  ["negative reference", { referenceGenomeVersion: -1 }], ["fractional reference", { referenceGenomeVersion: 2.5 }],
  ["nonfinite reference", { referenceGenomeVersion: Infinity }], ["Postgres int4 overflow", { referenceGenomeVersion: 2147483648 }],
  ["request sentence override", { sentence: "a replacement" }], ["request profile override", { verifierProfile: "anything" }],
]) rejects(() => buildIssuedVoiceContract({ ...BASE, ...patch }), `builder refuses ${name} without coercion`);

rejects(() => buildIssuedVoiceContract(Object.assign(Object.create({ hidden: true }), BASE)), "builder refuses custom prototype");
rejects(() => buildIssuedVoiceContract({ ...BASE, [Symbol("extra")]: true }), "builder refuses symbol keys");
let getterRuns = 0;
const accessor = { ...BASE };
Object.defineProperty(accessor, "nonce", { get() { getterRuns++; return BASE.nonce; }, enumerable: true });
rejects(() => buildIssuedVoiceContract(accessor), "builder refuses accessors before invoking caller code");
assert.equal(getterRuns, 0);
rejects(() => getIssuedVoiceProfile("azure-shared-audio/v2"), "unknown profile cannot fall back to current registry");

for (const field of ["schema", "sentence_bank_version", "sentence_bank_sha256", "sentence_hash", "nonce_sha256",
  "normalizer_version", "decision_policy_version", "verifier_profile", "verifier_profile_sha256"]) {
  const tampered = clone(built); tampered.contract[field] = "changed";
  tampered.contractSha256 = hashObject(tampered.contract);
  rejects(() => validateIssuedVoiceContract(tampered, tampered.contractSha256), `rehashing cannot admit changed ${field}`);
}
for (const [name, mutate] of [
  ["sentence", (v) => v.sentence += " different"], ["nonce", (v) => v.nonce = "9 8 7 6 5 4"],
  ["outer hash", (v) => v.contractSha256 = "f".repeat(64)],
  ["uppercase hash", (v) => v.contractSha256 = v.contractSha256.toUpperCase()],
  ["hash trailing newline", (v) => v.contractSha256 += "\n"],
  ["missing contract field", (v) => delete v.contract.normalizer_version],
  ["extra contract field", (v) => v.contract.transcript = "private text"],
  ["extra envelope field", (v) => v.enabled = true],
  ["numeric schema", (v) => v.contract.schema = 1], ["null contract", (v) => v.contract = null],
]) { const value = clone(built); mutate(value); rejects(() => validateIssuedVoiceContract(value, built.contractSha256), `validator refuses ${name}`); }
rejects(() => validateIssuedVoiceContract(built, null), "null persisted commitment is not an omitted authority check");
rejects(() => validateIssuedVoiceContract(built), "omitted persisted commitment is refused");

// Executable negative controls: mutate the production function source in memory
// and demonstrate the exact protection's absence accepts the forbidden input.
const moduleUrl = new URL("../api/_voice-identity/issued-contract.js", import.meta.url);
const original = readFileSync(moduleUrl, "utf8");
async function mutant(before, after) {
  assert.equal(original.split(before).length, 2, "mutation must target exactly one guard");
  const contractsUrl = new URL("../api/_replica-processing/contracts.js", import.meta.url).href;
  const source = original.replace(before, after).replace('"../_replica-processing/contracts.js"', JSON.stringify(contractsUrl));
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}
const withoutProfileBinding = await mutant('if (CONTRACT_KEYS.some((key) => c[key] !== rebuilt.contract[key])) fail("binding");',
  'if (false) fail("binding");');
const substituted = clone(built); substituted.contract.verifier_profile = "unsupported-provider/v9";
assert.doesNotThrow(() => withoutProfileBinding.validateIssuedVoiceContract(substituted, built.contractSha256));
assert.throws(() => validateIssuedVoiceContract(substituted, built.contractSha256));
ok("negative control: removed field binding admits an unsupported profile");
const withoutExpected = await mutant('envelope.contractSha256 !== expectedContractSha256) fail("expected_hash");',
  'false) fail("expected_hash");');
const alternate = buildIssuedVoiceContract({ ...BASE, nonce: "9 8 7 6 5 4" });
assert.doesNotThrow(() => withoutExpected.validateIssuedVoiceContract(alternate, built.contractSha256));
assert.throws(() => validateIssuedVoiceContract(alternate, built.contractSha256));
ok("negative control: removed persisted-hash guard admits a different valid issued commitment");
console.log(`\n${checks} issued contract checks passed (pure fixtures; no issuance, serving or identity acceptance)`);
