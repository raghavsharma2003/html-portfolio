import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SELF_TEST_ENVIRONMENT,
  SELF_TEST_GRANT_METADATA,
  applySelfTestAutoGrant,
  bootstrapSelfTestReplica,
  selfTestModeEnabled,
} from "../../api/_replica-processing/self-test.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OWNER = "20000000-0000-4000-8000-000000000002";
const OTHER_OWNER = "20000000-0000-4000-8000-000000000003";
const REPLICA = "10000000-0000-4000-8000-000000000001";
const VALID_ENV = Object.freeze({
  REPLICA_SELF_TEST_MODE: "true",
  REPLICA_SELF_TEST_ENVIRONMENT: SELF_TEST_ENVIRONMENT,
  REPLICA_SELF_TEST_OWNER_USER_ID: OWNER,
});
let checks = 0;

function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}

ok("self-test is off when every variable is absent", !selfTestModeEnabled({}, OWNER));
ok("the legacy single true flag is inert", !selfTestModeEnabled({ REPLICA_SELF_TEST_MODE: "true" }, OWNER));
ok("truthy aliases and case variants cannot enable the bypass",
  !selfTestModeEnabled({ ...VALID_ENV, REPLICA_SELF_TEST_MODE: "1" }, OWNER)
  && !selfTestModeEnabled({ ...VALID_ENV, REPLICA_SELF_TEST_MODE: "TRUE" }, OWNER));
ok("the internal-testing marker is mandatory and exact",
  !selfTestModeEnabled({ ...VALID_ENV, REPLICA_SELF_TEST_ENVIRONMENT: "production" }, OWNER)
  && !selfTestModeEnabled({ ...VALID_ENV, REPLICA_SELF_TEST_ENVIRONMENT: "internal-owner-testing " }, OWNER));
ok("the allowlisted owner must be a real UUID", !selfTestModeEnabled({
  ...VALID_ENV,
  REPLICA_SELF_TEST_OWNER_USER_ID: "owner",
}, OWNER));
ok("a different account cannot inherit the test bypass", !selfTestModeEnabled(VALID_ENV, OTHER_OWNER));
ok("all three exact guards enable only the allowlisted owner", selfTestModeEnabled(VALID_ENV, OWNER));

await assert.rejects(
  bootstrapSelfTestReplica(async () => { throw new Error("database must not be reached"); }, {
    ownerUserId: OWNER,
    replicaId: "not-a-replica",
    env: VALID_ENV,
  }),
  (error) => error?.status === 400 && error?.code === "valid_replica_id_required",
);
ok("an enabled test path still validates replica ids before SQL", true);

let rejectedDbCalls = 0;
const rejected = await bootstrapSelfTestReplica(async () => {
  rejectedDbCalls += 1;
  throw new Error("database must not be reached");
}, { ownerUserId: OTHER_OWNER, replicaId: REPLICA, env: VALID_ENV });
ok("a mismatched owner is rejected before any database call", rejected.applied === false && rejectedDbCalls === 0);

const scopedCalls = [];
const notSelf = await bootstrapSelfTestReplica(async (sql, params) => {
  scopedCalls.push({ sql, params });
  return [];
}, { ownerUserId: OWNER, replicaId: REPLICA, env: VALID_ENV });
ok("a correctly configured flag still refuses a non-self or unowned replica",
  notSelf.reason === "not_a_self_replica"
  && /r\.subject_mode='self'/.test(scopedCalls[0].sql)
  && /r\.owner_user_id=\$2::uuid/.test(scopedCalls[0].sql)
  && scopedCalls[0].params[0] === REPLICA
  && scopedCalls[0].params[1] === OWNER);
ok("the bootstrap inserts all six private ingestion and model scopes",
  /array\['capture','transcription','storage','biometric','training','inference'\]/.test(scopedCalls[0].sql));
ok("every automatic grant carries a revocable guard-contract marker",
  SELF_TEST_GRANT_METADATA.self_test_mode === true
  && SELF_TEST_GRANT_METADATA.granted_by === "REPLICA_SELF_TEST_MODE"
  && SELF_TEST_GRANT_METADATA.guard_contract === "owner-only-internal-testing/v1");

let postReadyDbCalls = 0;
const postReadyRejected = await applySelfTestAutoGrant(async () => {
  postReadyDbCalls += 1;
  throw new Error("database must not be reached");
}, { ownerUserId: OTHER_OWNER, replicaId: REPLICA, env: VALID_ENV });
ok("post-processing auto-review uses the same owner guard",
  postReadyRejected.applied === false && postReadyDbCalls === 0);

const runtime = readFileSync(join(ROOT, "api/_replica-processing/runtime.js"), "utf8");
ok("the processing caller checks the actual leased owner before invoking the bypass",
  /selfTestModeEnabled\(env, leased\.job\.owner_user_id\)/.test(runtime));
const sourceRoute = readFileSync(join(ROOT, "api/replica-source.js"), "utf8");
ok("the authenticated source route bootstraps before it checks upload consent",
  sourceRoute.indexOf("await bootstrapSelfTestReplica") < sourceRoute.indexOf("await createPendingSource")
  && /ownerUserId: user\.id/.test(sourceRoute));

console.log(`\n${checks} replica self-test mode checks passed`);
