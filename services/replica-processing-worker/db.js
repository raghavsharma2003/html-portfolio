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
      // Carry the SQLSTATE, and ONLY the SQLSTATE.
      //
      // `neon_query_failed` alone cannot be acted on: every statement in this
      // lane is a single large CTE, so "the query failed" is true of a lease
      // collision, a constraint, and the deliberate division-by-zero that
      // `commitProcessingOutput`'s collision guard uses to abort. Those need
      // three different responses and looked identical from the logs.
      //
      // A SQLSTATE is five characters from a fixed vocabulary. It is not
      // tenant data and cannot carry any: the provider's `message` can quote
      // row values, so it is read past and never attached.
      let sqlstate = "";
      try {
        const body = await response.json();
        const raw = String(body?.code || "");
        if (/^[0-9A-Z]{5}$/.test(raw)) sqlstate = raw;
      } catch { /* provider response is not evidence */ }
      const code = sqlstate ? `neon_query_failed_${sqlstate}` : "neon_query_failed";
      throw Object.assign(new Error(code), { code, sqlstate, retryable: response.status >= 500 });
    }
    const value = await response.json().catch(() => null);
    if (!value || !Array.isArray(value.rows)) throw new Error("neon_response_invalid");
    return value.rows;
  };
}

