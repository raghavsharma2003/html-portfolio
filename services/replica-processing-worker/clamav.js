import { spawn } from "node:child_process";
import { runTool } from "../../api/_replica-processing/native-tools.js";

// BRINGING UP THE SCANNER, AND ONLY WHEN THERE IS SOMETHING TO SCAN
// ---------------------------------------------------------------------------
// `clamd` holds the entire signature set in memory, so starting it costs a
// large, fixed load before it can answer anything. That cost is paid per
// execution, and this job is scheduled, so it would otherwise be paid several
// hundred times a day to discover an empty queue.
//
// So the caller runs `pendingWork` first and only calls `startClamd` when the
// queue actually holds a step this container is the owner of. See run-once.js.
//
// The signature refresh stays mandatory and stays fatal on failure. That is
// deliberate and it is not the same question as when to start the daemon: a
// scanner running on signatures we could not refresh is a scanner making a
// weaker claim than the one the pipeline will record. The image bakes a
// database at build time, so this refresh fetches incremental diffs rather
// than the whole set, which is what makes a mandatory refresh affordable.

const CONFIG_DIR = "/srv/worker/services/replica-processing-worker";
export const CLAMD_CONFIG_PATH = `${CONFIG_DIR}/clamd.conf`;
const FRESHCLAM_CONFIG_PATH = `${CONFIG_DIR}/freshclam.conf`;

function toolError(code, retryable = false) {
  return Object.assign(new Error(code), { code, retryable });
}

/** Refresh signatures. Failure is fatal: see the header. */
export async function refreshSignatures(options = {}) {
  const result = await runTool("freshclam", [
    `--config-file=${FRESHCLAM_CONFIG_PATH}`, "--stdout",
  ], "", { timeoutMs: options.timeoutMs || 300_000, code: "freshclam", maxOutput: 256 * 1024 });
  // freshclam exits 0 on update and 1 when the database is already current.
  // Both mean the signatures in front of us are the current ones, which is the
  // only question being asked here. Anything else is a refresh that did not
  // happen and must not be rounded up to one.
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw toolError("clamav_signature_refresh_failed", true);
  }
  return Object.freeze({ exitCode: result.exitCode });
}

/** Start clamd and wait until it actually answers, not merely until it forks. */
export async function startClamd(options = {}) {
  const deadlineMs = options.deadlineMs || 240_000;
  const child = spawn("clamd", [`--config-file=${CLAMD_CONFIG_PATH}`, "--foreground"], {
    stdio: ["ignore", "ignore", "ignore"],
    detached: false,
  });
  child.on("error", () => {});
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    // `clamdscan --ping` is the daemon answering on its socket. A version
    // string or a running process is neither: clamd binds its socket well
    // before it has finished loading signatures, and a scan issued in that
    // window fails for a reason that has nothing to do with the file.
    const ping = await runTool("clamdscan", [
      `--config-file=${CLAMD_CONFIG_PATH}`, "--ping", "1",
    ], "", { timeoutMs: 15_000, code: "clamd_ping", maxOutput: 16 * 1024 }).catch(() => null);
    if (ping && ping.exitCode === 0) {
      return Object.freeze({ child, readyMs: Date.now() - started });
    }
    if (child.exitCode !== null) throw toolError("clamd_exited_during_startup");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  child.kill("SIGKILL");
  throw toolError("clamd_not_ready");
}
