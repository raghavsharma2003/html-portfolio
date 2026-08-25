import { fail } from "./errors.js";

export function abortAfter(milliseconds, parent) {
  const timeout = AbortSignal.timeout(milliseconds);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

export async function boundedBytes(response, maxBytes, code) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) fail(code, 413);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      fail(code, 413);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export async function boundedJson(response, maxBytes, code) {
  const bytes = await boundedBytes(response, maxBytes, code);
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail(code); }
}

export function jsonResponse(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(payload);
}

export function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error("request_too_large"), { code: "request_too_large", status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks, total).toString("utf8")));
    req.on("error", reject);
  });
}
