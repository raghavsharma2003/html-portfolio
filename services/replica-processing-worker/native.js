import { spawn } from "node:child_process";

function toolError(code, retryable = false) {
  return Object.assign(new Error(code), { code, retryable });
}

function runTool(command, args, input, options = {}) {
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

export async function scanWithClamAv(bytes, options = {}) {
  const result = await runTool("clamdscan", [
    "--config-file=/srv/worker/services/replica-processing-worker/clamd.conf", "--no-summary", "--stream",
  ], bytes, {
    signal: options.signal, timeoutMs: 180_000, code: "clamav", maxOutput: 64 * 1024,
  });
  if (result.exitCode === 0 && /:\s+OK\s*$/m.test(result.stdout)) return Object.freeze({ safe: true, signatures: [] });
  if (result.exitCode === 1 && /FOUND\s*$/m.test(result.stdout)) {
    const match = result.stdout.match(/:\s+([^:\r\n]+)\s+FOUND\s*$/m);
    return Object.freeze({ safe: false, signatures: Object.freeze(match ? [match[1].trim().slice(0, 120)] : ["detected"]) });
  }
  throw toolError("clamav_scan_failed", true);
}

export async function probeWithFfprobe(bytes, options = {}) {
  const result = await runTool("ffprobe", [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,sample_rate,channels",
    "-of", "json", "pipe:0",
  ], bytes, { signal: options.signal, timeoutMs: 90_000, code: "ffprobe", maxOutput: 256 * 1024 });
  if (result.exitCode !== 0) throw toolError("media_probe_decode_failed");
  let value;
  try { value = JSON.parse(result.stdout); } catch { throw toolError("media_probe_output_invalid"); }
  const audio = Array.isArray(value?.streams) ? value.streams.find((stream) => stream.codec_type === "audio") : null;
  const duration = Number(value?.format?.duration);
  const sampleRate = Number(audio?.sample_rate);
  const channels = Number(audio?.channels);
  if (!audio || !Number.isFinite(duration) || duration <= 0 || !Number.isInteger(sampleRate) || !Number.isInteger(channels)) {
    throw toolError("media_probe_output_invalid");
  }
  return Object.freeze({
    duration_ms: Math.max(1, Math.round(duration * 1000)),
    sample_rate_hz: sampleRate,
    channels,
    codec: String(audio.codec_name || "unknown").slice(0, 80),
  });
}
