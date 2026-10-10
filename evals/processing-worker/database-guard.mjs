import assert from "node:assert/strict";
import { createNeonDb } from "../../services/replica-processing-worker/db.js";
import { runDevelopmentOnce } from "../../services/replica-processing-worker/dev-once.js";
const name = "vyakti_expert_integration_20260906";
const env = { NEON_URL: `postgresql://test:test@fixture.invalid/${name}`, VYAKTI_DEV_DATABASE: name, VYAKTI_DEV_WORKER: "1" };
let checks = 0;
function ok(label, fn) { fn(); checks++; console.log(`ok ${checks} - ${label}`); }
for (const expected of ["neondb", "", "bad-name", "x;select"]) {
  ok(`reject expected database ${JSON.stringify(expected)} before network`, () => assert.throws(() => createNeonDb({ env, expectedDatabase: expected, fetchImpl: () => { throw new Error("network_called"); } }), /neon_expected_database_mismatch/));
}
let requests = [];
const fake = (reported) => async (_url, init) => {
  const body = JSON.parse(init.body); requests.push(body.query);
  return new Response(JSON.stringify({ rows: body.query === "SELECT current_database() AS name" ? [{ name: reported }] : [{ done: true }] }), { status: 200 });
};
const wrong = createNeonDb({ env, expectedDatabase: name, fetchImpl: fake("neondb") });
await assert.rejects(wrong("UPDATE fixture SET value=1"), /neon_expected_database_mismatch/);
await assert.rejects(wrong("DELETE FROM fixture"), /neon_expected_database_mismatch/);
ok("server mismatch is sticky and never forwards mutation", () => assert.deepEqual(requests, ["SELECT current_database() AS name"]));
requests = [];
const matching = createNeonDb({ env, expectedDatabase: name, fetchImpl: fake(name) });
await Promise.all([matching("SELECT 1"), matching("SELECT 2")]);
ok("concurrent calls verify once before either application statement", () => assert.deepEqual(requests, ["SELECT current_database() AS name", "SELECT 1", "SELECT 2"]));
requests = [];
const unbound = createNeonDb({ env, fetchImpl: fake("neondb") });
await unbound("SELECT 1");
ok("existing production connection remains opt-in for this guard", () => assert.deepEqual(requests, ["SELECT 1"]));
requests = [];
const unavailable = createNeonDb({ env, expectedDatabase: name, fetchImpl: async () => { throw new Error("private_url_must_not_escape"); } });
await assert.rejects(unavailable("UPDATE fixture SET value=1"), /^Error: neon_unreachable$/); checks++;
let work = 0;
const makeDb = (reported) => () => async () => [{ name: reported }];
const run = async () => { work++; return { outcome: "fixture_only" }; };
for (const changed of [ { VYAKTI_DEV_DATABASE: "neondb" }, { VYAKTI_DEV_DATABASE: "" }, { VYAKTI_DEV_WORKER: "" }, { REPLICA_EXPECTED_DATABASE: "neondb" }, { REPLICA_SELF_TEST_MODE: "true" } ]) {
  await assert.rejects(runDevelopmentOnce({ env: { ...env, ...changed }, mode: "erasure", createDb: makeDb(name), run })); checks++;
}
await assert.rejects(runDevelopmentOnce({ env, mode: "erasure", createDb: makeDb("neondb"), run }), /dev_database_identity_mismatch/); checks++;
ok("all refused invocations leave the worker uncalled", () => assert.equal(work, 0));
const checked = await runDevelopmentOnce({ env: { ...env, VYAKTI_DEV_WORKER: "" }, mode: "check", createDb: makeDb(name), run });
ok("check-only mode verifies without invoking work", () => { assert.equal(checked.work_started, false); assert.equal(work, 0); });
for (const mode of ["processing", "erasure"]) {
  await runDevelopmentOnce({ env, mode, createDb: makeDb(name), run });
}
ok("each accepted explicit mode invokes exactly once", () => assert.equal(work, 2));
console.log(`Database binding: ${checks} assertions passed with mocked HTTP/worker; no real SQL, leases, storage or processing executed.`);
