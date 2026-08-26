import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

// THE TWO NATIVE SEAMS, AND THE ONE RULE THEY ARE HELD TO
// ---------------------------------------------------------------------------
// `createNativeMediaAdapters` in providers/native-media.js takes `scanBytes`
// and `probeBytes` as injected functions. It never implements them, and it is
// right not to: a malware scan is a subprocess call to a signature engine and a
// media probe is a subprocess call to a demuxer, and neither of those is
// something an API module can conjure.
//
// This module is that injection, and its law is the pipeline's own comment:
// never manufacture evidence. A scan we cannot actually perform must NOT come
// back "clean". A clean verdict is not a neutral default; it is a positive
// claim that the rest of the pipeline will trust and act on, and a fabricated
// one is strictly worse than no scan at all because it is indistinguishable
// from a real one downstream.
//
// So there are exactly three outcomes here and no fourth:
//   1. the tool is present and says OK      -> { safe: true }
//   2. the tool is present and says FOUND   -> { safe: false, signatures }
//   3. the tool is not present, or ran and did not produce a verdict we can
//      read -> THROW a named code. Never (3) collapsing into (1).
//
// Case 3 is the normal case on a serverless runtime, which has neither
// `clamdscan` nor `ffprobe` on its PATH. That is not a bug to be papered over.
// It is the true statement that this runtime cannot perform this step, and the
// sweep turns it into a job that stops with a legible reason rather than a job
// that quietly blesses unscanned bytes.

/** The tools, their env overrides, and the code each one's absence produces. */
export const NATIVE_TOOLS = Object.freeze({
  malware_scan: Object.freeze({
    binary: "clamdscan",
    override: "CLAMDSCAN_PATH",
    absentCode: "malware_scanner_unavailable",
  }),
  media_probe: Object.freeze({
    binary: "ffprobe",
    override: "FFPROBE_PATH",
    absentCode: "media_probe_tool_unavailable",
  }),
});

function toolError(code, retryable = false) {
  return Object.assign(new Error(code), { code, retryable });
}

function executable(candidate) {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve a binary the way a shell would, plus an explicit env override.
 *
 *  Deliberately does NOT spawn anything to find out. Spawning `which` on a
 *  runtime that has no `which` is its own failure mode, and a capability probe
 *  that can fail for a second reason is a capability probe that will one day
 *  report the wrong thing.
 */
export function resolveNativeTool(tool, env = process.env) {
  const spec = NATIVE_TOOLS[tool];
  if (!spec) throw toolError("native_tool_unknown");
  const override = String(env[spec.override] || "").trim();
  if (override) return isAbsolute(override) && executable(override) ? override : null;
  const path = String(env.PATH || "");
  if (!path) return null;
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, spec.binary);
    if (executable(candidate)) return candidate;
  }
  return null;
}

/** What this runtime can honestly do, as data rather than as a guess. */
export function nativeToolStatus(env = process.env) {
  const status = {};
  for (const tool of Object.keys(NATIVE_TOOLS)) {
    const resolved = resolveNativeTool(tool, env);
    status[tool] = Object.freeze({
      available: Boolean(resolved),
      code: resolved ? "" : NATIVE_TOOLS[tool].absentCode,
    });
  }
  return Object.freeze(status);
}

/** Spawn a tool, feed it bytes on stdin, and bound everything about it.
 *
 *  Shared with the container worker so there is ONE implementation of the
 *  subprocess contract. Two copies of this would drift, and the copy that
 *  drifted would be the one deciding whether a file is malware.
 */
export function runTool(command, args, input, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let finished = false;
    const maxOutput = options.maxOutput || 1024 * 1024;
    const settle = (fn, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      fn(value);
    };
    const abort = () => {
      child.kill("SIGKILL");
      settle(reject, toolError(`${options.code || "native_tool"}_aborted`));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(reject, toolError(`${options.code || "native_tool"}_timeout`, true));
    }, options.timeoutMs || 120_000);
    options.signal?.addEventListener("abort", abort, { once: true });
    child.on("error", () => settle(reject, toolError(`${options.code || "native_tool"}_unavailable`, true)));
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) {
      stream.on("data", (chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > maxOutput) {
          child.kill("SIGKILL");
          settle(reject, toolError(`${options.code || "native_tool"}_output_too_large`));
        } else chunks.push(Buffer.from(chunk));
      });
    }
    child.on("close", (exitCode) => settle(resolve, {
      exitCode: Number(exitCode),
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** Read a clamdscan run into a verdict, or refuse to.
 *
 *  Exported separately from the spawn so the parse is testable without a
 *  scanner installed, which is the only way the negative control below can be
 *  a real test rather than a skipped one.
 */
export function readClamAvVerdict(result) {
  if (result.exitCode === 0 && /:\s+OK\s*$/m.test(result.stdout)) {
    return Object.freeze({ safe: true, signatures: Object.freeze([]) });
  }
  if (result.exitCode === 1 && /FOUND\s*$/m.test(result.stdout)) {
    const match = result.stdout.match(/:\s+([^:\r\n]+)\s+FOUND\s*$/m);
    return Object.freeze({ safe: false, signatures: Object.freeze(match ? [match[1].trim().slice(0, 120)] : ["detected"]) });
  }
  // Any other exit code is a scanner that did not answer the question. It is
  // NOT an answer of "clean", and the retryable flag says a transient scanner
  // fault is worth another attempt rather than a silent pass.
  throw toolError("clamav_scan_failed", true);
}

/** Read an ffprobe run into bounded audio facts, or refuse to. */
export function readFfprobeFacts(result) {
  if (result.exitCode !== 0) throw toolError("media_probe_decode_failed");
  let value;
  try { value = JSON.parse(result.stdout); } catch { throw toolError("media_probe_output_invalid"); }
  const audio = Array.isArray(value?.streams) ? value.streams.find((stream) => stream.codec_type === "audio") : null;
  const duration = Number(value?.format?.duration);
  const sampleRate = Number(audio?.sample_rate);
  const channels = Number(audio?.channels);
  if (!audio) throw toolError("no_audio_stream");
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(sampleRate) || !Number.isInteger(channels)) {
    throw toolError("media_probe_output_invalid");
  }
  return Object.freeze({
    duration_ms: Math.max(1, Math.round(duration * 1000)),
    sample_rate_hz: sampleRate,
    channels,
    codec: String(audio.codec_name || "unknown").slice(0, 80),
  });
}

/** The injected pair, bound to whatever this runtime actually has.
 *
 *  `clamdConfigPath` is the container's clamd.conf. It is an option rather than
 *  a constant because the path only exists inside the worker image, and a
 *  hard-coded absolute path is how a module stops being reusable.
 */
export function createNativeToolRunners(options = {}) {
  const env = options.env || process.env;
  const clamdConfigPath = options.clamdConfigPath ? String(options.clamdConfigPath) : "";
  return Object.freeze({
    async scanBytes(bytes, callOptions = {}) {
      const command = resolveNativeTool("malware_scan", env);
      if (!command) throw toolError(NATIVE_TOOLS.malware_scan.absentCode);
      const args = ["--no-summary", "--stream"];
      if (clamdConfigPath) args.unshift(`--config-file=${clamdConfigPath}`);
      return readClamAvVerdict(await runTool(command, args, bytes, {
        signal: callOptions.signal, timeoutMs: 180_000, code: "clamav", maxOutput: 64 * 1024,
      }));
    },
    async probeBytes(bytes, callOptions = {}) {
      const command = resolveNativeTool("media_probe", env);
      if (!command) throw toolError(NATIVE_TOOLS.media_probe.absentCode);
      return readFfprobeFacts(await runTool(command, [
        "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,sample_rate,channels",
        "-of", "json", "pipe:0",
      ], bytes, { signal: callOptions.signal, timeoutMs: 90_000, code: "ffprobe", maxOutput: 256 * 1024 }));
    },
  });
}
