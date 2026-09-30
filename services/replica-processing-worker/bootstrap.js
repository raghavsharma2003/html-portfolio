import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createNeonDb } from "./db.js";

export const PROCESSING_DATABASE = "neondb";

export function assertProcessingWorkerConfiguration(env = process.env) {
  if (
    env.REPLICA_EXPECTED_DATABASE !== PROCESSING_DATABASE ||
    env.VYAKTI_MODEL_SERVING !== "azure_only" ||
    env.REPLICA_SELF_TEST_MODE === "true"
  ) {
    throw new Error("processing_worker_configuration_required");
  }
}

function writeRuntimeConfig(env) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  execFileSync(process.execPath, ["scripts/write-config.mjs"], {
    cwd: root,
    env: { ...env, CI: "1" },
    stdio: ["ignore", "ignore", "ignore"],
  });
}

/**
 * Verify the immutable production binding before generating the ignored
 * runtime config or loading any worker module. Dependency injection exists so
 * the order and fail-closed branches can be exercised without a network or a
 * processing execution.
 */
export async function startProcessingWorker(options = {}) {
  const env = options.env || process.env;
  assertProcessingWorkerConfiguration(env);
  const createDb = options.createDb || createNeonDb;
  const db = createDb({ env, expectedDatabase: PROCESSING_DATABASE });
  await db("SELECT 1 AS ready");
  (options.writeConfig || writeRuntimeConfig)(env);
  await (options.loadWorker || (() => import("./run-once.js")))();
}
