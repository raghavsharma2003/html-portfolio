// Diagnostic sink: accepts batched audit records from the app and stores them
// for root-cause analysis. Content-free by contract (the client sends timings,
// counts and decisions, never conversation text) — see src/engine/diag.ts.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";

const MAX_RECORDS = 200;
const MAX_EVENT = 64;
const MAX_DETAIL_CHARS = 1000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  // batches are ~1 per 4s per client; this is generous but bounded
  if (!allow(ipOf(req), "diag", 90)) return res.status(429).json({ error: "slow down" });

  const { device, session, records } = req.body || {};
  if (!device || !Array.isArray(records) || !records.length) {
    return res.status(400).json({ error: "bad batch" });
  }

  const rows = records.slice(0, MAX_RECORDS).filter((r) => r && typeof r.event === "string");
  if (!rows.length) return res.status(200).json({ ok: true, stored: 0 });

  // one multi-row INSERT: a batch costs a single round trip
  const values = [];
  const params = [];
  let i = 1;
  for (const r of rows) {
    let detail = r.detail && typeof r.detail === "object" ? r.detail : {};
    const s = JSON.stringify(detail);
    if (s.length > MAX_DETAIL_CHARS) detail = { truncated: true };
    values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
    params.push(
      String(device).slice(0, 64),
      String(session || "").slice(0, 64),
      String(r.scope || "app").slice(0, 16),
      String(r.event).slice(0, MAX_EVENT),
      Number.isFinite(r.t) ? Math.round(r.t) : 0,
      JSON.stringify(detail),
      new Date(Number.isFinite(r.at) ? r.at : Date.now()).toISOString(),
    );
  }

  try {
    // serverless freezes the moment the response is sent — the write must be
    // awaited or the batch silently disappears
    await q(
      `insert into meera_diag (device_id, session_id, scope, event, t_ms, detail, at)
       values ${values.join(", ")}`,
      params,
    );
    return res.status(200).json({ ok: true, stored: rows.length });
  } catch {
    // never surface storage trouble to the app — diagnostics are not the product
    return res.status(200).json({ ok: false });
  }
}
