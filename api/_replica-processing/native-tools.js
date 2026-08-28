import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  // `separate`'s own windowing (WS-AO) needs to cut short spans of owner
  // speech out of the original recording before anything is sent to the GPU.
  // Same binary as media_probe -- ffmpeg and ffprobe ship together -- but
  // named separately so a runtime that has ffprobe without the encoder half
  // (unusual, but not this repo's job to assume) reports its own absence
  // rather than borrowing media_probe's code for a different capability.
  reference_window: Object.freeze({
    binary: "ffmpeg",
    override: "FFMPEG_PATH",
    absentCode: "reference_window_tool_unavailable",
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
  const diagnostic = `${result.stdout || ""}\n${result.stderr || ""}`.toLowerCase();
  // Content-free failure classes survive into the processing attempt without
  // retaining scanner output, temp paths, or provider text. This is the
  // diagnostic boundary the former one-code implementation was missing.
  if (/instream.*(?:size|length).*limit|size limit exceeded/.test(diagnostic)) {
    throw toolError("clamav_scan_size_limit");
  }
  if (/could not connect|can't connect|connection (?:refused|reset)|clamd.*not running/.test(diagnostic)) {
    throw toolError("clamav_daemon_unavailable", true);
  }
  if (/access denied|permission denied|fdpass.*(?:fail|error)/.test(diagnostic)) {
    throw toolError("clamav_scan_access_failed", true);
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
    async scanFile(file, callOptions = {}) {
      const command = resolveNativeTool("malware_scan", env);
      if (!command) throw toolError(NATIVE_TOOLS.malware_scan.absentCode);
      // `--stream` sends the entire body through clamd's INSTREAM protocol and
      // is capped by StreamMaxLength. A local worker already owns a private
      // 0600 temp file, so pass its descriptor over the Unix socket instead.
      // This keeps the daemon from needing path permissions and removes both
      // the stdin buffer and INSTREAM ceiling from large source scans.
      const args = ["--no-summary", "--fdpass", file];
      if (clamdConfigPath) args.unshift(`--config-file=${clamdConfigPath}`);
      return readClamAvVerdict(await runTool(command, args, "", {
        signal: callOptions.signal, timeoutMs: 600_000, code: "clamav", maxOutput: 64 * 1024,
      }));
    },
    async scanBytes(bytes, callOptions = {}) {
      const command = resolveNativeTool("malware_scan", env);
      if (!command) throw toolError(NATIVE_TOOLS.malware_scan.absentCode);
      const args = ["--no-summary", "--stream"];
      if (clamdConfigPath) args.unshift(`--config-file=${clamdConfigPath}`);
      return readClamAvVerdict(await runTool(command, args, bytes, {
        signal: callOptions.signal, timeoutMs: 180_000, code: "clamav", maxOutput: 64 * 1024,
      }));
    },
    async probeFile(file, callOptions = {}) {
      const command = resolveNativeTool("media_probe", env);
      if (!command) throw toolError(NATIVE_TOOLS.media_probe.absentCode);
      return readFfprobeFacts(await runTool(command, [
        "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,sample_rate,channels",
        "-of", "json", file,
      ], "", { signal: callOptions.signal, timeoutMs: 180_000, code: "ffprobe", maxOutput: 256 * 1024 }));
    },
    // ffprobe is given a FILE, not a pipe, and that is load-bearing.
    //
    // Measured on the owner's real 32.9 MB MP3 inside the worker image, 2026-08-26:
    //   ffprobe ... pipe:0   -> exit 0, streams complete, "format": {}
    //   ffprobe ... <path>   -> exit 0, streams complete, "duration": "822.720000"
    //
    // Same binary, same bytes, same arguments. A pipe is not seekable, and an
    // MP3's duration is not in a header ffprobe can read going forwards - it
    // comes from seeking to the end or from a Xing frame it has to seek to. So
    // on a pipe the duration is simply absent, `readFfprobeFacts` rightly
    // refuses the result, and the step fails `media_probe_output_invalid` on a
    // recording that is perfectly fine. That is what the owner's job did.
    //
    // The bytes are already fully in memory (bounded by the storage read cap),
    // so materialising them costs a write and a delete, and buys a probe that
    // works for every container format rather than only the seek-free ones.
    async probeBytes(bytes, callOptions = {}) {
      const command = resolveNativeTool("media_probe", env);
      if (!command) throw toolError(NATIVE_TOOLS.media_probe.absentCode);
      const dir = await mkdtemp(join(options.tmpDir || tmpdir(), "probe-"));
      const file = join(dir, randomBytes(8).toString("hex"));
      try {
        await writeFile(file, bytes);
        return readFfprobeFacts(await runTool(command, [
          "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,sample_rate,channels",
          "-of", "json", file,
        ], "", { signal: callOptions.signal, timeoutMs: 90_000, code: "ffprobe", maxOutput: 256 * 1024 }));
      } finally {
        // The source bytes must not outlive the probe. Best effort by
        // necessity: a failure to clean up must not mask the probe's verdict.
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },

    // Materialise the ORIGINAL recording once, so `extractWindow` below can be
    // called many times (once per candidate owner-speech run) against the same
    // file instead of rewriting a 30+ MB buffer to disk on every call. Same
    // "ffmpeg wants a seekable file, not a pipe" reasoning as probeBytes above
    // -- `-ss` before `-i` does fast, seek-based trimming, and a pipe cannot be
    // seeked.
    async withMaterializedAudio(bytes, fn, callOptions = {}) {
      const command = resolveNativeTool("reference_window", env);
      if (!command) throw toolError(NATIVE_TOOLS.reference_window.absentCode);
      const dir = await mkdtemp(join(options.tmpDir || tmpdir(), "refwin-"));
      const file = join(dir, randomBytes(8).toString("hex"));
      try {
        await writeFile(file, bytes);
        return await fn({
          // One short span [startMs, endMs) of the ORIGINAL recording,
          // resampled to the 16 kHz mono PCM16 WAV shape `windows.js` scores
          // and `separate`'s adapter accepts. `-ss` before `-i` is an INPUT
          // seek (fast; accurate to the nearest decodable frame, which is all
          // window SELECTION needs -- this is not a legal transcript
          // timestamp). Bounded to 10 minutes per call so a malformed span
          // cannot turn into an unbounded ffmpeg run.
          //
          // The OUTPUT is also a file, not a pipe. Measured: ffmpeg writing a
          // WAV to `pipe:1` cannot seek back to patch the `data` chunk's size
          // once it knows the real one, so it emits the placeholder
          // `0xFFFFFFFF` -- and `readPcm16Wav` (correctly, for the on-disk
          // uploads it was built for) treats a `data` size that overruns the
          // buffer as `window_audio_truncated`, refusing every single window
          // this call would ever produce. A file gets ffmpeg's real,
          // seeked-back size, same as `probeBytes` above needs a file for the
          // matching reason on the READ side.
          // `rate` defaults to 16000 -- the shape `windows.js`'s scorer reads
          // and refuses anything else, so every SCORING pass stays exactly as
          // it was. WS-AS (2026-08-27) adds the ability to ask for a
          // DIFFERENT rate for the one call that matters: once the best
          // window is already chosen, the bytes that actually leave this
          // container as the voice reference must be cut from the ORIGINAL
          // file at its own bandwidth, not sliced out of the 16 kHz buffer
          // that was only ever built to be scored. See reference-window.js's
          // header for the measured reason (the owner's enrollment reference
          // carried 0.46% of its energy above 8 kHz).
          async extractWindow(startMs, endMs, { rate = 16000 } = {}) {
            const startSec = Math.max(0, Number(startMs) / 1000);
            const durSec = (Number(endMs) - Number(startMs)) / 1000;
            if (!(durSec > 0) || durSec > 600) throw toolError("reference_window_span_invalid");
            const sampleRate = Number(rate);
            if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) {
              throw toolError("reference_window_rate_invalid");
            }
            const outFile = join(dir, `${randomBytes(8).toString("hex")}.wav`);
            try {
              const result = await runTool(command, [
                "-nostdin", "-y", "-v", "error",
                "-ss", startSec.toFixed(3), "-i", file, "-t", durSec.toFixed(3),
                "-vn", "-ac", "1", "-ar", String(sampleRate), "-sample_fmt", "s16",
                "-f", "wav", outFile,
              ], "", { signal: callOptions.signal, timeoutMs: 60_000, code: "reference_window", maxOutput: 4 * 1024 });
              if (result.exitCode !== 0) throw toolError("reference_window_extract_failed");
              const { readFile } = await import("node:fs/promises");
              const wav = await readFile(outFile);
              if (wav.length < 44) throw toolError("reference_window_extract_failed");
              return wav;
            } finally {
              await rm(outFile, { force: true }).catch(() => {});
            }
          },
        });
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
    async withAudioFile(file, fn, callOptions = {}) {
      const command = resolveNativeTool("reference_window", env);
      if (!command) throw toolError(NATIVE_TOOLS.reference_window.absentCode);
      const dir = await mkdtemp(join(options.tmpDir || tmpdir(), "refwin-out-"));
      try {
        return await fn({
          async extractWindow(startMs, endMs, { rate = 16000 } = {}) {
            const startSec = Math.max(0, Number(startMs) / 1000);
            const durSec = (Number(endMs) - Number(startMs)) / 1000;
            if (!(durSec > 0) || durSec > 900) throw toolError("reference_window_span_invalid");
            const sampleRate = Number(rate);
            if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) {
              throw toolError("reference_window_rate_invalid");
            }
            const outFile = join(dir, `${randomBytes(8).toString("hex")}.wav`);
            try {
              const result = await runTool(command, [
                "-nostdin", "-y", "-v", "error",
                "-ss", startSec.toFixed(3), "-i", file, "-t", durSec.toFixed(3),
                "-vn", "-ac", "1", "-ar", String(sampleRate), "-sample_fmt", "s16",
                "-f", "wav", outFile,
              ], "", { signal: callOptions.signal, timeoutMs: 120_000, code: "reference_window", maxOutput: 4 * 1024 });
              if (result.exitCode !== 0) throw toolError("reference_window_extract_failed");
              const { readFile } = await import("node:fs/promises");
              const wav = await readFile(outFile);
              if (wav.length < 44) throw toolError("reference_window_extract_failed");
              return wav;
            } finally {
              await rm(outFile, { force: true }).catch(() => {});
            }
          },
        });
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  });
}
