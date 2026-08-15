// Session clock — the client half of SPEC §9.3, and the AGE-TIER gate surface
// of §9.4. One timer, three consumers, one rule: the timer speaks as the APP,
// never as her (§0.3 adjudication — instruction ≠ emission is measured, so a
// statutory disclosure can never ride on a persona rule).
//
// What lives here and why it is CLIENT code at all:
//
//  - The server (api/clock.js, vy_session) is the auditable record. But a
//    server outage cannot be allowed to silence a legally required disclosure
//    (CA SB 243 / NY: recurring notification during continuing interaction;
//    China: 2h continuous-use break trigger). So this file is a full MIRROR:
//    it accumulates continuous_ms itself, persists across reloads in
//    localStorage, and fires the card with zero network. The beat loop merely
//    reconciles with the server when it can — and reconciliation takes
//    MAX(local, server): the failure direction is always toward disclosing.
//  - Age tier (§9.4): `unverified` structurally receives the minor-safe
//    configuration, and the 'minor' branch of gatesFor() does not consult the
//    config table at all — a misconfigured flag cannot re-enable engagement
//    mechanics for a minor, because that code path never reads flags.
//  - T9 (§3.2): clockNote() is the machine-readable session-age note the
//    context compiler appends so she never contradicts the card and owns it
//    plainly if asked (never-deny-AI). It is DATA, telegraphic, ≤300 chars —
//    never a line she could recite.
//
// "Continuous" means: the app is visible. Hidden time never accumulates; a
// gap ≥30 min (hidden, closed, or simply silent — timers frozen counts too)
// resets the stretch and mints a new clock-session id, matching vy_session's
// "resets on 30-min gaps" semantics exactly.

import { Capacitor } from "@capacitor/core";
import { tel } from "./telemetry";

const BASE = Capacitor.isNativePlatform?.() ? "https://meera-silk.vercel.app" : "";

// ── age tier (§9.4) ───────────────────────────────────────────────────────

export type AgeTier = "unverified" | "adult_verified" | "minor";

/** What the tier permits. Consumed by the engine (brain.ts, via the
 *  WS-COMPILER interface ticket) and by any UI surface that would render an
 *  engagement mechanic. All-false is the safe shape. */
export interface TierGates {
  /** streaks, re-engagement bait, variable-reward drops — DPDP §9(2)'s
   *  "addictive engagement patterns", the product-design rule */
  engagementMechanics: boolean;
  /** romance/intimate registers — prohibited entirely for minors (China
   *  Interim Measures; CA SB 243 minor provisions) */
  romanceRegisters: boolean;
}

// Frozen and NEVER consulted through the config table: the §9.4 hard-refusal
// path. If every flag in the product is misconfigured, this object is still
// what a minor gets.
const MINOR_HARD_GATES: TierGates = Object.freeze({
  engagementMechanics: false,
  romanceRegisters: false,
});

const GATE_CONFIG: Record<Exclude<AgeTier, "minor">, TierGates> = {
  // §0.3 adjudication: unverified = minor-safe defaults, structurally.
  unverified: Object.freeze({ engagementMechanics: false, romanceRegisters: false }),
  adult_verified: Object.freeze({ engagementMechanics: true, romanceRegisters: true }),
};

/** The one gate function. 'minor' short-circuits to a frozen constant before
 *  any config is read; an unknown tier string fails safe to the same place. */
export function gatesFor(tier: AgeTier): TierGates {
  if (tier === "minor") return MINOR_HARD_GATES;
  return GATE_CONFIG[tier] ?? MINOR_HARD_GATES;
}

// ── clock thresholds (per-jurisdiction/per-tier, as data — §9.3) ──────────

export interface TierClock {
  /** statutory AI-disclosure card cadence. 3h = CA SB 243 / NY floor. */
  discloseEveryMs: number;
  /** break-nudge cadence. 2h = China's continuous-use trigger, adopted for
   *  all adults; stricter for the minor-safe tiers. */
  breakEveryMs: number;
}

const H = 3_600_000;
const TIER_CLOCK: Record<AgeTier, TierClock> = {
  adult_verified: { discloseEveryMs: 3 * H, breakEveryMs: 2 * H },
  // minor-safe = stricter clock (§9.4): disclose at 2h, nudge hourly.
  unverified: { discloseEveryMs: 2 * H, breakEveryMs: 1 * H },
  minor: { discloseEveryMs: 2 * H, breakEveryMs: 1 * H },
};

// restrictiveness rank for tier reconciliation: when local and server
// disagree, the MORE restrictive tier wins (fail-safe direction, §0.3).
const RESTRICT: Record<AgeTier, number> = { adult_verified: 0, unverified: 1, minor: 2 };
const saferTier = (a: AgeTier, b: AgeTier): AgeTier => (RESTRICT[a] >= RESTRICT[b] ? a : b);

// ── engine state ──────────────────────────────────────────────────────────

export type FireKind = "disclosure" | "break";

export interface ClockFire {
  kind: FireKind;
  /** which boundary this is (1 = first card of the stretch) */
  n: number;
  continuousMs: number;
  tier: AgeTier;
  /** false = the mirror fired this with the server unreachable */
  serverReachable: boolean;
}

const GAP_RESET_MS = 30 * 60_000; // §2.6: continuous_ms resets on 30-min gaps
const TICK_MS = 5_000;
const BEAT_MS = 60_000;
const STORE_KEY = "meera.clock.v1";

interface Persisted {
  sid: string;
  cms: number; // continuous ms this stretch
  la: number; // last activity (wall clock) — the gap detector across reloads
  fd: number; // disclosure boundaries already fired this stretch
  fb: number; // break boundaries already fired this stretch
  tier: AgeTier;
}

// injectable for staging thresholds and tests — simulated time is how the 3h
// gate is verified without waiting 3 hours (§13 WS-SAFETY eval gate)
let nowFn: () => number = () => Date.now();
let cfg: Record<AgeTier, TierClock> = TIER_CLOCK;
let tickMs = TICK_MS;
let beatMs = BEAT_MS;

let device = "";
let sid = "";
let cms = 0;
let lastTickAt = 0;
let fired = { disclosure: 0, break: 0 };
let tier: AgeTier = "unverified"; // §9.4: the default IS the minor-safe tier
let started = false;
let sinceBeat = Infinity; // first tick beats immediately
let serverOk = false; // last beat's outcome — stamped on fires for RCA
let crisisHold = false;
let pendingBreak = 0; // deferred (never canceled) break boundary, §9.3
let current: ClockFire | null = null;
let cardShownAtMs = 0; // continuous_ms when the last card fired (for T9)
let subs: ((f: ClockFire | null) => void)[] = [];
let interval: ReturnType<typeof setInterval> | null = null;

const rand = () => Math.random().toString(36).slice(2, 8);
const newSid = () => `clk-${Date.now().toString(36)}-${rand()}`;

function persist() {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ sid, cms, la: nowFn(), fd: fired.disclosure, fb: fired.break, tier } satisfies Persisted),
    );
  } catch {
    /* storage full/absent: the in-memory clock still runs */
  }
}

function restore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as Persisted;
    // the stretch survives a reload only if the gap does not reset it — a
    // safety timer that restarts on refresh is decoration
    if (p && typeof p.la === "number" && nowFn() - p.la < GAP_RESET_MS) {
      sid = String(p.sid || "");
      cms = Math.max(0, Number(p.cms) || 0);
      fired = { disclosure: Math.max(0, Number(p.fd) || 0), break: Math.max(0, Number(p.fb) || 0) };
    }
    if (p?.tier && RESTRICT[p.tier as AgeTier] !== undefined)
      tier = saferTier(tier, p.tier as AgeTier);
  } catch {
    /* corrupt copy — start a fresh stretch */
  }
}

function resetStretch() {
  sid = newSid();
  cms = 0;
  fired = { disclosure: 0, break: 0 };
  pendingBreak = 0;
  cardShownAtMs = 0;
  tel("clock.stretch_reset", { session: sid });
  persist();
}

function emit(f: ClockFire | null) {
  current = f;
  for (const s of subs) {
    try {
      s(f);
    } catch {
      /* a broken subscriber must not stop the clock */
    }
  }
}

function post(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    return fetch(`${BASE}/api/clock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device, session: sid, ...body }),
      keepalive: true,
    }).then(
      (r) => (r.ok ? (r.json().catch(() => null) as Promise<Record<string, unknown> | null>) : null),
      () => null,
    );
  } catch {
    return Promise.resolve(null);
  }
}

function fire(kind: FireKind, n: number) {
  const f: ClockFire = { kind, n, continuousMs: cms, tier, serverReachable: serverOk };
  cardShownAtMs = cms;
  emit(f);
  tel(kind === "break" ? "clock.break" : "clock.disclosed", {
    session: sid,
    n,
    continuous_min: Math.round(cms / 60_000),
    tier,
    via: serverOk ? "synced" : "mirror",
  });
  // the server's disclosure ledger (vy_session.disclosures + meera_events) —
  // fail-soft: the card is already up, the record catches up when it can
  void post({ op: "disclosed", kind, n, continuous_ms: Math.round(cms) });
}

function beat() {
  void post({ op: "beat", continuous_ms: Math.round(cms), tier }).then((r) => {
    if (!r || r.ok !== true) {
      serverOk = false;
      return;
    }
    serverOk = true;
    // MAX, both directions of drift: the mirror can never be argued DOWN by
    // the server, and a client whose storage was wiped inherits the server's
    // count. Failing toward disclosure is the entire design (§9.3).
    const scms = Number(r.continuous_ms);
    if (Number.isFinite(scms) && scms > cms) cms = scms;
    const sd = Number(r.disclosures);
    if (Number.isFinite(sd) && sd > fired.disclosure) fired.disclosure = sd;
    const st = r.age_tier as AgeTier;
    if (st && RESTRICT[st] !== undefined) tier = saferTier(tier, st);
  });
}

/** One accumulation step. The production interval calls this every 5s; tests
 *  and the staging harness call it directly under an injected clock. */
export function clockTick() {
  if (!started) return;
  const t = nowFn();
  const dt = Math.max(0, t - lastTickAt);
  lastTickAt = t;

  if (dt >= GAP_RESET_MS) {
    // 30 min of silence — hidden, suspended, or closed. New stretch.
    resetStretch();
    return;
  }
  // hidden time is a gap, never usage
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

  cms += dt;

  const c = cfg[tier] ?? cfg.unverified;

  // statutory disclosure: NEVER deferred, not even by the crisis protocol —
  // the card is app-voiced and does not interrupt her (§9.3)
  const dueD = Math.floor(cms / c.discloseEveryMs);
  if (dueD > fired.disclosure) {
    fired.disclosure = dueD;
    fire("disclosure", dueD);
  } else {
    // break nudge: deferred — never canceled — while crisis is active (§9.3).
    // A disclosure boundary on the same tick absorbs it (the card already
    // says take a break).
    const dueB = Math.floor(cms / c.breakEveryMs);
    if (dueB > fired.break) {
      fired.break = dueB;
      if (crisisHold) {
        pendingBreak = dueB;
        tel("clock.break_deferred", { session: sid, n: dueB, continuous_min: Math.round(cms / 60_000) });
      } else {
        fire("break", dueB);
      }
    }
  }

  sinceBeat += dt;
  if (sinceBeat >= beatMs) {
    sinceBeat = 0;
    beat();
  }
  persist();
}

/** Start the clock. Idempotent; safe to call from a component mount. */
export function startSessionClock(deviceId: string) {
  if (deviceId) device = deviceId;
  if (started) return;
  started = true;
  restore();
  if (!sid) sid = newSid();
  lastTickAt = nowFn();
  sinceBeat = Infinity;
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      // returning from hidden: the hidden span is a gap. clockTick's own
      // dt check handles the reset; this just stops the span accumulating.
      if (document.visibilityState === "visible") lastTickAt = nowFn();
    });
  }
  if (!interval && typeof setInterval !== "undefined") interval = setInterval(clockTick, tickMs);
  void refreshTier();
}

/** Subscribe to card fires. The current fire (if a card should be up) is
 *  delivered immediately, so a late-mounting card never misses one. */
export function onClockFire(fn: (f: ClockFire | null) => void): () => void {
  subs.push(fn);
  if (current) fn(current);
  return () => {
    subs = subs.filter((s) => s !== fn);
  };
}

/** The user acknowledged the card. Dismissal is allowed (§9.3) — the fire is
 *  already logged on both sides; the next boundary will fire regardless. */
export function dismissCard() {
  if (!current) return;
  tel("clock.card_dismissed", { session: sid, kind: current.kind, n: current.n });
  emit(null);
}

/** Crisis protocol hook: while active, break nudges are deferred (never
 *  canceled, deferral logged); the statutory disclosure still fires. */
export function clockCrisisHold(active: boolean) {
  crisisHold = active;
  if (!active && pendingBreak > 0) {
    const n = pendingBreak;
    pendingBreak = 0;
    fire("break", n);
  }
}

// ── T9: the machine-readable note (compiler-consumed, never her voice) ────

/** ≤300 chars (T9 budget). Telegraphic k:v so nothing here is sentence-shaped
 *  — anything sentence-shaped in a prompt gets recited (CLAUDE.md). */
export function clockNote(): string {
  const min = Math.round(cms / 60_000);
  const last = cardShownAtMs ? Math.round(cardShownAtMs / 60_000) : 0;
  return (
    `SESSION_CLOCK: continuous_min=${min}; cards_shown=${fired.disclosure + fired.break}; ` +
    `last_card_min=${last}; card_up=${current ? 1 : 0}; tier=${tier}`
  ).slice(0, 300);
}

// ── age-tier plumbing (§9.4) ──────────────────────────────────────────────

export function getAgeTier(): AgeTier {
  return tier;
}

/** Pull the persisted tier from vy_person. Fail-soft: unreachable server
 *  leaves the local (never-less-restrictive) tier standing. */
export async function refreshTier(): Promise<AgeTier> {
  const r = await post({ op: "tier" });
  const st = r?.age_tier as AgeTier | undefined;
  if (st && RESTRICT[st] !== undefined) {
    tier = saferTier(tier, st);
    persist();
  }
  return tier;
}

/** Request a tier change. The SERVER refuses escalation (no verification lane
 *  exists yet — §9.4: launch is verified-adult-only via config, not via a
 *  client asking nicely); a restriction is also applied locally IMMEDIATELY,
 *  whether or not the network round trip succeeds. */
export async function setAgeTier(next: AgeTier): Promise<AgeTier> {
  if (RESTRICT[next] === undefined) return tier;
  if (RESTRICT[next] >= RESTRICT[tier]) {
    tier = next; // more (or equally) restrictive: applies now, network or not
    tel("clock.tier_changed", { tier: next });
    persist();
  }
  const r = await post({ op: "tier", set: next });
  const st = r?.age_tier as AgeTier | undefined;
  if (st && RESTRICT[st] !== undefined) {
    tier = saferTier(tier, st);
    persist();
  }
  return tier;
}

// ── staging/test injection ────────────────────────────────────────────────

/** Override the time source, cadences, or thresholds. This is how staging
 *  verifies "fires at 3h" by simulating time instead of waiting for it, and
 *  how the eval gates drive the engine deterministically. Production never
 *  calls it. */
export function configureClock(opts: {
  now?: () => number;
  clock?: Partial<Record<AgeTier, TierClock>>;
  tickMs?: number;
  beatMs?: number;
}) {
  if (opts.now) nowFn = opts.now;
  if (opts.clock) cfg = { ...cfg, ...(opts.clock as Record<AgeTier, TierClock>) };
  if (opts.tickMs) tickMs = opts.tickMs;
  if (opts.beatMs !== undefined) beatMs = opts.beatMs;
  if (interval) {
    clearInterval(interval);
    interval = started && typeof setInterval !== "undefined" ? setInterval(clockTick, tickMs) : null;
  }
}

/** Test-only teardown so suites can run multiple scenarios in one process. */
export function __resetClockForTest() {
  if (interval) clearInterval(interval);
  interval = null;
  started = false;
  device = "";
  sid = "";
  cms = 0;
  lastTickAt = 0;
  fired = { disclosure: 0, break: 0 };
  tier = "unverified";
  sinceBeat = Infinity;
  serverOk = false;
  crisisHold = false;
  pendingBreak = 0;
  current = null;
  cardShownAtMs = 0;
  subs = [];
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* no storage in this environment */
  }
}
