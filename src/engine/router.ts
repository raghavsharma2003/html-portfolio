// Model router — SPEC.md §7 (M5, WS-ROUTER, owned exclusively per §13).
//
// `route(lane, laneConfig, models, opts)` is a PURE function (§7.1: "Pure
// function route(lane, vy_model rows, health) → ordered candidates") — it
// does no I/O, mints no ids, reads no clock unless `opts.now` is withheld.
// Everything it needs — the `vy_model` rows, the per-lane incumbent/
// candidate/fallback wiring, and current key/quota health — is handed in by
// the caller. That caller is a call-site adoption concern (api/chat.js,
// brain.ts, the watch pipeline) and is explicitly NOT this workstream's edit
// per §13's file-ownership table — it is an interface ticket. This file only
// has to be correct in isolation, which is also what makes it esbuild-
// bundleable with zero external deps (see scripts/derive-adapter.mjs and
// api/route.js's re-implementation note below).
//
// LANE DELIBERATELY EXCLUDES "live". SPEC §7.1: "Realtime lanes are pinned
// architecture choices, not slug swaps (`live-model-bake`, `azure-realtime-
// shape` reversal conditions attached in config comments)." `live-model-
// swap` (context/rejected.md) and `realtime-azure` (context/rejected.md) are
// both settled NOs — five of six bidi-capable models measured worse, two in
// ways that break shipped features (video rejected; barge-in missed). Giving
// the router's own type system no "live" value to route is the same
// unrepresentable-bad-state technique the schema uses for `age_tier` (§9.4):
// a call site cannot accidentally route the live lane through this module
// even by mistake, because `Lane` has no such member.
export type Lane = "chat" | "vision" | "extraction";

// vy_model.gate CHECK constraint, db/schema.sql migration 005 / SPEC §2.6.
export type Gate = "untested" | "failed" | "passed";

/** Mirrors a `vy_model` row (db/schema.sql). Field-for-field, so a row read
 * straight off Neon needs no reshaping before reaching `route()`. */
export interface ModelRow {
  model: string;
  provider: string;
  billing: "credits" | "cash" | "user";
  card_risk: boolean;
  prefix_cache: boolean;
  residency: string;
  max_tokens_mode: "visible_only" | "total";
  effort_map?: Record<string, unknown>;
  adapter?: Record<string, unknown>;
  adapter_derived_at?: string | null;
  gate: Gate;
}

/** One lane's wiring: which model is the safety-net incumbent, which
 * gated candidates are contending, and (extraction only, today) which
 * model is the credits/cash fallback if the primary errors outright.
 * This is a DIFFERENT fallback from api/chat.js's free-pool → OpenRouter
 * transport fallback for one model — the router sits ABOVE that mechanism
 * and does not replace it (per this ticket's own read-first instruction).
 * A `fallback` here is a different MODEL entry entirely. */
export interface LaneConfig {
  incumbent: string | null;
  candidates: string[];
  fallback: string | null;
}

/** Per-model runtime health, owned by the caller (it is the thing watching
 * real responses). `emptyReplyStreak` names SPEC §7.1's "empty-200-as-quota
 * guard kept" — api/chat.js already treats a 200 with empty content as
 * exhausted for the free Gemini pool; this generalizes that rule to any
 * routed model rather than re-deriving it per lane. */
export interface HealthEntry {
  quotaExhaustedUntil?: number; // epoch ms; set by the caller on a 429/403
  emptyReplyStreak?: number;
}

export interface RouteOptions {
  /** Defaults to Date.now() — overridable so `route()` stays pure in tests. */
  now?: number;
  /** SPEC §7.1: "billing/card_risk (credits-partner trap) — card-risk models
   * unroutable without explicit owner pin." A model is only routable while
   * card_risk is true if its name is in this set. */
  ownerPins?: Set<string>;
  health?: Record<string, HealthEntry>;
  /** Swap-test hook (§7.3): "the incumbent re-tagged under a new
   * adapter_version label; SWAP and SHAM differ in exactly one bit." Keyed
   * by model. When present for a routed model, its value REPLACES the
   * derived adapter_version label — no other field of the decision changes,
   * which is the whole point: a sham run must be indistinguishable from a
   * real one except in this one stamped value, and it is stamped into
   * telemetry, never into the prompt (§7.3: "Arm stamped into telemetry,
   * never into the prompt"). */
  adapterVersionOverride?: Record<string, string>;
}

export interface RoutedCandidate {
  model: string;
  role: "candidate" | "incumbent" | "fallback";
  adapter_version: string;
  gate: Gate;
}

/** Why a model in `laneConfig` was or was not routed — the shape
 * api/route.js's diagnostics surface reports (SPEC §13 owns column 2). */
export interface Explained {
  model: string;
  role: "candidate" | "incumbent" | "fallback";
  eligible: boolean;
  reason: string;
  adapter_version: string;
}

// SPEC §7.1: "empty-200-as-quota guard kept." Two consecutive empty replies
// from a model are treated the same as a quota exhaustion, not tried again
// this route() call — matches api/chat.js's own single-empty-reply guard on
// the free Gemini pool, generalized to a streak so one transient blank
// reply (network splice, a genuinely terse turn) doesn't permanently exile
// a healthy model from a single unlucky sample.
const EMPTY_STREAK_GUARD = 2;

/**
 * Eligibility test for ONE model, independent of its role in the lane.
 * SPEC §7.1's checklist, applied in the cheapest-first order the repo
 * favors elsewhere (schema CHECK before writer-window before entailment
 * audit, §4.2): a missing row is cheaper to detect than a gate query, which
 * is cheaper than a live health lookup.
 */
export function eligibility(
  row: ModelRow | undefined,
  opts: RouteOptions,
): { ok: boolean; reason: string } {
  if (!row) return { ok: false, reason: "no vy_model row" };
  if (row.gate !== "passed") return { ok: false, reason: `gate=${row.gate}` };
  if (row.card_risk && !opts.ownerPins?.has(row.model)) {
    return { ok: false, reason: "card_risk without owner pin (credits-partner trap)" };
  }
  const now = opts.now ?? Date.now();
  const health = opts.health?.[row.model];
  if (health?.quotaExhaustedUntil && health.quotaExhaustedUntil > now) {
    return { ok: false, reason: "quota-exhausted (cooling)" };
  }
  if ((health?.emptyReplyStreak ?? 0) >= EMPTY_STREAK_GUARD) {
    return { ok: false, reason: "empty-200-as-quota guard" };
  }
  if (!row.prefix_cache) {
    // Not a disqualifier — `cache-9x`: a model with no prefix cache is
    // routable, it is just 9.2x more expensive per the repo's own measured
    // ratio. Eligibility says yes; ordering (below) is where this is felt.
    return { ok: true, reason: "eligible (no prefix cache — cache-9x cost applies)" };
  }
  return { ok: true, reason: "eligible" };
}

function adapterVersionOf(model: string, row: ModelRow | undefined, opts: RouteOptions): string {
  const override = opts.adapterVersionOverride?.[model];
  if (override) return override;
  return row?.adapter_derived_at ? `derived-${row.adapter_derived_at}` : "baseline";
}

/**
 * Ordered, ELIGIBLE-ONLY candidate list for one lane. Ordering: gated
 * candidates first (a passed candidate is the thing being proven — SPEC
 * §7.1's "first live routing decision goes through the gate"), then the
 * incumbent (the safety net), then the lane's model-level fallback, if any.
 * Within the candidates group, prefix-cached models sort first (cache-9x).
 * An ineligible entry is silently skipped here — that is SPEC §7.1's
 * "failover semantics kept inside it"; `explainLane` below is where a
 * skip's reason surfaces for diagnostics instead of disappearing.
 */
export function route(
  lane: Lane,
  laneConfig: LaneConfig,
  models: Record<string, ModelRow>,
  opts: RouteOptions = {},
): RoutedCandidate[] {
  void lane; // lane selects `laneConfig` upstream; kept in the signature so a
  // call site cannot pass a live-lane-shaped config through the wrong lane
  // by accident, and so `toTelemetryDetail` below can stamp it without a
  // second parameter threading through every caller.
  const out: RoutedCandidate[] = [];
  const seen = new Set<string>();
  const tryPush = (model: string | null, role: RoutedCandidate["role"]) => {
    if (!model || seen.has(model)) return;
    seen.add(model);
    const row = models[model];
    const { ok } = eligibility(row, opts);
    if (!ok) return;
    out.push({
      model,
      role,
      adapter_version: adapterVersionOf(model, row, opts),
      gate: row!.gate,
    });
  };
  const orderedCandidates = [...laneConfig.candidates].sort((a, b) => {
    const pa = models[a]?.prefix_cache ? 0 : 1;
    const pb = models[b]?.prefix_cache ? 0 : 1;
    return pa - pb;
  });
  for (const c of orderedCandidates) tryPush(c, "candidate");
  tryPush(laneConfig.incumbent, "incumbent");
  tryPush(laneConfig.fallback, "fallback");
  return out;
}

/**
 * Every model wired to this lane, eligible or not, with its reason —
 * api/route.js's read-only diagnostics surface reports this directly. Never
 * used for actual routing (that's `route()`); this exists so "why isn't the
 * candidate serving" has a machine-readable answer instead of a grep.
 */
export function explainLane(
  laneConfig: LaneConfig,
  models: Record<string, ModelRow>,
  opts: RouteOptions = {},
): Explained[] {
  const rows: Array<{ model: string | null; role: Explained["role"] }> = [
    ...laneConfig.candidates.map((model) => ({ model, role: "candidate" as const })),
    { model: laneConfig.incumbent, role: "incumbent" as const },
    { model: laneConfig.fallback, role: "fallback" as const },
  ];
  const out: Explained[] = [];
  for (const { model, role } of rows) {
    if (!model) continue;
    const row = models[model];
    const { ok, reason } = eligibility(row, opts);
    out.push({
      model,
      role,
      eligible: ok,
      reason,
      adapter_version: adapterVersionOf(model, row, opts),
    });
  }
  return out;
}

/**
 * Swap-test hook (§7.3): "Sham arm = router no-op: the incumbent re-tagged
 * under a new adapter_version label; SWAP and SHAM differ in exactly one
 * bit." Deterministic from a timestamp so two callers computing a sham for
 * the same minute agree without coordinating, and so it is trivially
 * distinguishable from a genuine derivation's `derived-<iso>` label (that
 * one comes from `vy_model.adapter_derived_at`, set only by a real §7.2 run;
 * this one is stamped `sham-<iso>` and never touches `adapter_derived_at`).
 */
export function shamAdapterVersion(now: number = Date.now()): string {
  return `sham-${new Date(now).toISOString()}`;
}

/**
 * Shapes one routed decision into the plain object src/engine/diag.ts's
 * `diag(scope, event, detail)` already accepts as its third argument — so
 * wiring this at a call site is `diag("chat", "route.decision",
 * toTelemetryDetail(lane, decision))`, not new plumbing. SPEC §7.3: "Every
 * turn logs {model, adapter_version, core_hash, manifest_hash, snapshot_ver}
 * to telemetry" — `core_hash`/`manifest_hash`/`snapshot_ver` are WS-COMPILER
 * / WS-RELSTATE fields this module has no way to know, so they are left for
 * the call site to merge in; what this function owns is the router's own
 * three fields (lane, model, gate) plus the swap-test arm marker. Content-
 * free by the diag contract (api/diag.js's own comment): model names and
 * gate states, never conversation text.
 */
export function toTelemetryDetail(
  lane: Lane,
  decision: RoutedCandidate,
): Record<string, unknown> {
  return {
    lane,
    model: decision.model,
    role: decision.role,
    gate: decision.gate,
    adapter_version: decision.adapter_version,
  };
}
