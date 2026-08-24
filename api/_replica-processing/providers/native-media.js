import { ProcessingAdapterError, assertSha256, sha256Hex } from "../contracts.js";

function fail(code, retryable = false) {
  throw new ProcessingAdapterError(code, { code, retryable });
}

async function resolvedBytes(resolver, source, inputs, signal) {
  if (!Array.isArray(inputs) || inputs.length !== 1) fail("native_media_input_invalid");
  let resolved;
  try { resolved = await resolver({ source, input: inputs[0], signal }); }
  catch { fail("native_media_input_unavailable", true); }
  if (!resolved || typeof resolved !== "object" || "url" in resolved || "signedReadUrl" in resolved) fail("native_media_private_url_forbidden");
  const bytes = Buffer.isBuffer(resolved.body)
    ? resolved.body
    : ArrayBuffer.isView(resolved.body)
      ? Buffer.from(resolved.body.buffer, resolved.body.byteOffset, resolved.body.byteLength)
      : null;
  if (!bytes?.length) fail("native_media_input_body_invalid");
  const digest = assertSha256(inputs[0].sha256, "native media input sha256");
  if (sha256Hex(bytes) !== digest || (resolved.byteSize != null && Number(resolved.byteSize) !== bytes.length)) {
    fail("native_media_input_integrity_mismatch");
  }
  return { bytes, mime: resolved.mime || inputs[0].mime, sha256: digest };
}

export function createNativeMediaAdapters(options = {}) {
  if (typeof options.resolveInput !== "function" || typeof options.scanBytes !== "function" || typeof options.probeBytes !== "function") {
    fail("native_media_dependencies_required");
  }
  return Object.freeze({
    integrity: Object.freeze({
      family: "integrity", name: "server-private-byte-verifier", version: "sha256-v1",
      async verify({ source, inputs, signal }) {
        const input = await resolvedBytes(options.resolveInput, source, inputs, signal);
        return Object.freeze({ sha256: input.sha256, byte_size: input.bytes.length, sniffed_mime: input.mime });
      },
    }),
    malware_scan: Object.freeze({
      family: "malware", name: "clamav-stream", version: String(options.clamavVersion || "clamav-runtime"),
      async scan({ source, inputs, signal }) {
        const input = await resolvedBytes(options.resolveInput, source, inputs, signal);
        const verdict = await options.scanBytes(input.bytes, { signal });
        if (!verdict || typeof verdict.safe !== "boolean") fail("malware_scanner_response_invalid", true);
        return Object.freeze({ safe: verdict.safe, signatures: Object.freeze(verdict.signatures || []) });
      },
    }),
    media_probe: Object.freeze({
      family: "media-probe", name: "ffprobe-sandbox", version: String(options.ffprobeVersion || "ffprobe-runtime"),
      async probe({ source, inputs, signal }) {
        const input = await resolvedBytes(options.resolveInput, source, inputs, signal);
        const result = await options.probeBytes(input.bytes, { signal });
        if (!result || !Number.isInteger(result.duration_ms) || result.duration_ms < 1 ||
            !Number.isInteger(result.sample_rate_hz) || result.sample_rate_hz < 8_000 ||
            !Number.isInteger(result.channels) || result.channels < 1 || !result.codec) {
          fail("media_probe_response_invalid");
        }
        return Object.freeze(result);
      },
    }),
  });
}

