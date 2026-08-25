function neonConfig(env = process.env) {
  const connection = String(env.NEON_URL || "");
  let parsed;
  try { parsed = new URL(connection); } catch { throw new Error("neon_url_required"); }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol) || !parsed.hostname || !parsed.username || !parsed.password) {
    throw new Error("neon_url_invalid");
  }
  return Object.freeze({ connection, endpoint: `https://${parsed.hostname}/sql` });
}

export function createNeonDb(options = {}) {
  const config = neonConfig(options.env || process.env);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  return async (query, params = [], timeoutMs = 30_000) => {
    let response;
    try {
      response = await fetchImpl(config.endpoint, {
        method: "POST",
        headers: { "Neon-Connection-String": config.connection, "Content-Type": "application/json" },
        body: JSON.stringify({ query, params }),
        signal: AbortSignal.timeout(Math.max(1_000, Math.min(120_000, timeoutMs))),
      });
    } catch { throw Object.assign(new Error("neon_unreachable"), { code: "neon_unreachable", retryable: true }); }
    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* provider response is not evidence */ }
      throw Object.assign(new Error("neon_query_failed"), { code: "neon_query_failed", retryable: response.status >= 500 });
    }
    const value = await response.json().catch(() => null);
    if (!value || !Array.isArray(value.rows)) throw new Error("neon_response_invalid");
    return value.rows;
  };
}

