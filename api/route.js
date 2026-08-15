// Router diagnostics — SPEC.md §7 / §13 (WS-ROUTER, M5, owned exclusively).
// GET/POST /api/route → { lanes: { chat, vision, extraction }, recent_gate_runs }.
//
// READ-ONLY BY DESIGN (§13's own line for this file: "the server surface
// reporting current routing + gate states"). It never writes vy_model or
// vy_gate_run — seeding those tables for real is an open interface ticket
// (see config/models.json's own top comment), not something a diagnostics
// GET should do as a side effect of being polled.
//
// PLAIN JS, ZERO CROSS-IMPORT FROM src/ — same discipline api/chat.js's own
// comment states for OPERATIONAL_CORE_CAP: "a Vercel serverless function
// here stays plain JS with zero cross-imports from src/, and this proxy is
// the outer guard that must survive even if the bundler that builds src/ is
// unavailable." The routing/eligibility logic below is therefore a
// DELIBERATE TWIN of src/engine/router.ts's `eligibility()` / `route()` /
// `explainLane()` — same shape the repo already keeps in two other pairs
// (compiler.ts's caps mirrored in this same api/chat.js; scene.ts and
// SceneReader.java, per context/decisions.md `scene-hold-800`: "both move
// together or the Android lane silently keeps the old behaviour"). Keep
// this in sync with router.ts by hand; scripts/derive-adapter.mjs and any
// future test bundles router.ts itself via esbuild (the check-prompt-
// budget.mjs precedent) specifically so there is ALSO one code path that
// exercises the real TS source, not just this twin.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import seed from "../config/models.json" with { type: "json" };

const LANES = ["chat", "vision", "extraction"]; // NOT "live" — SPEC §7.1, pinned architecture

// Twin of router.ts's `eligibility()`. Health is not tracked server-side
// today (it is per-instance runtime state in api/_gkeys.js's model, not a
// durable row), so this endpoint reports gate/card_risk eligibility only —
// the parts that ARE durable — and says so explicitly in the response
// rather than implying a health check that did not happen.
function eligibility(row, ownerPins) {
  if (!row) return { ok: false, reason: "no vy_model row" };
  if (row.gate !== "passed") return { ok: false, reason: `gate=${row.gate}` };
  if (row.card_risk && !ownerPins.has(row.model)) {
    return { ok: false, reason: "card_risk without owner pin (credits-partner trap)" };
  }
  return { ok: true, reason: row.prefix_cache ? "eligible" : "eligible (no prefix cache — cache-9x cost applies)" };
}

function adapterVersionOf(row) {
  return row?.adapter_derived_at ? `derived-${row.adapter_derived_at}` : "baseline";
}

function explainLane(laneConfig, models, ownerPins) {
  const wired = [
    ...laneConfig.candidates.map((model) => ({ model, role: "candidate" })),
    { model: laneConfig.incumbent, role: "incumbent" },
    { model: laneConfig.fallback, role: "fallback" },
  ].filter((w) => w.model);
  return wired.map(({ model, role }) => {
    const row = models[model];
    const { ok, reason } = eligibility(row, ownerPins);
    return { model, role, eligible: ok, reason, adapter_version: adapterVersionOf(row), gate: row?.gate ?? "no vy_model row" };
  });
}

/** Strip the `_foo` authored-comment keys config/models.json carries so the
 * live-shaped rows this returns match db/schema.sql's vy_model columns
 * exactly, whether they came from the DB or the seed fallback. */
function stripNotes(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) if (!k.startsWith("_")) out[k] = v;
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "GET or POST only" });
  }
  // A diagnostics surface is still a public endpoint someone could hammer.
  if (!allow(ipOf(req), "route", 30)) return res.status(429).json({ error: "slow down" });

  const ownerPins = new Set(); // no pinning UI exists yet — an interface ticket, not fabricated here

  let liveModels = {};
  let usedFallback = false;
  try {
    const rows = await q(
      `select model, provider, billing, card_risk, prefix_cache, residency,
              max_tokens_mode, effort_map, adapter, adapter_derived_at, gate
         from vy_model`,
    );
    for (const r of rows) liveModels[r.model] = r;
  } catch {
    liveModels = {};
  }
  // §2.7: migrations 001-005 land with EMPTY tables; the DB is the source
  // of truth the instant it has rows for a model, and config/models.json's
  // authored seed is the fallback ONLY for models missing from it — the
  // exact shape api/consolidate.js's loadDecayConfig() already uses for
  // config/decay.json.
  const models = {};
  for (const name of Object.keys(seed.models)) {
    models[name] = liveModels[name] ?? stripNotes(seed.models[name]);
    if (!liveModels[name]) usedFallback = true;
  }

  let recentGateRuns = [];
  let gateRunsError = null;
  try {
    recentGateRuns = await q(
      `select model, battery, n, passed, at from vy_gate_run order by at desc limit 50`,
    );
  } catch (e) {
    gateRunsError = e?.message || "query failed";
  }

  const lanes = {};
  for (const lane of LANES) {
    const laneConfig = seed.lanes[lane];
    lanes[lane] = {
      config: laneConfig,
      explain: explainLane(laneConfig, models, ownerPins),
    };
  }

  return res.status(200).json({
    lanes,
    recent_gate_runs: recentGateRuns,
    gate_runs_error: gateRunsError,
    seed_fallback_used: usedFallback,
    note: "health (quota cooldown / empty-reply streak) is per-instance runtime state, not tracked here — see src/engine/router.ts RouteOptions.health for where a live caller would apply it on top of this eligibility view.",
  });
}
