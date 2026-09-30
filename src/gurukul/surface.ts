// The Gurukul/Meera product seam — NOT a `clock.ts` edit, and this file
// exists specifically so it never has to be one.
//
// ── why this is a product parameter, not a correction to clock.ts ─────────
//
// `clock.ts`'s `GATE_CONFIG.unverified` mapping to adult gates is stated in
// its own comment as an "OWNER DECISION 2026-08-15 (adult-default)... for the
// PRE-LAUNCH PERIOD" — a decision scoped to Meera, whose only users today are
// known adults. `SPEC-GURUKUL.md` §3 item 2 is explicit that this "does NOT
// carry over" to a student product whose users are overwhelmingly 16–18.
// Folding a second product's default into `clock.ts` would put two products'
// owner-decisions inside one constant, arguing about the same mapping for two
// different audiences — exactly the kind of edit that is easy to get backwards
// six months from now when only one of the two decisions is being revisited.
// So the default lives at the PRODUCT boundary, as data, and reaches the
// engine only through the engine's own public surface.
//
// ── the mechanism this leans on is already structural in clock.ts ─────────
//
// `setAgeTier()` (clock.ts) only ever moves a session TOWARD the more
// restrictive tier when called from client code — see its `RESTRICT`/
// `saferTier` comparison. `minor` is the most restrictive tier that exists,
// with `MINOR_HARD_GATES` frozen and never read through `GATE_CONFIG` at all.
// So calling `setAgeTier("minor")` once, early, on a Gurukul session does not
// require touching `gatesFor`, `GATE_CONFIG`, or the `unverified` mapping —
// it uses the exact safety rail those already provide: nothing downstream
// (a server reconciliation, a `refreshTier()` call, any other call site) can
// ever move the tier BELOW minor again for that session, because `saferTier`
// always keeps the more restrictive of the two.
//
// ── the narrowness of the seam ─────────────────────────────────────────────
//
// This module has exactly one product-facing export that does anything at
// runtime (`applyStudentSurfaceDefault`), and it is additive: unless a caller
// invokes it, nothing changes. The Meera app path never imports this module,
// so the Meera build is byte-identical whether this file exists or not — the
// flag is consumed, not flipped globally in `clock.ts` or `brain.ts`.

import type { AgeTier } from "../engine/clock";
import { setAgeTier } from "../engine/clock";

/** SPEC-GURUKUL.md §3 item 2: every Gurukul student account defaults to the
 *  minor-safe tier, structurally — not merely "off" by policy. */
export const STUDENT_SURFACE_DEFAULT_TIER: AgeTier = "minor";

export type ProductSurface = "meera" | "gurukul-student";

/**
 * Resolved once, from a build-time env var so a Gurukul build can set it
 * without touching Meera's build config or any shared source file. Absent
 * (the ordinary Meera build) resolves to `"meera"`, which is the byte-
 * identical case this whole seam exists to preserve.
 */
export const PRODUCT_SURFACE: ProductSurface = resolveSurface();

function resolveSurface(): ProductSurface {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return env?.VITE_PRODUCT_SURFACE === "gurukul-student" ? "gurukul-student" : "meera";
  } catch {
    // no import.meta.env in this runtime (an eval bundle, a non-Vite build) —
    // fail to the Meera default, never to the wider surface.
    return "meera";
  }
}

export const isGurukulStudentSurface = (): boolean => PRODUCT_SURFACE === "gurukul-student";

/**
 * Applies the student-surface default. Idempotent and safe to call on every
 * mount: `setAgeTier` is itself idempotent for an equally-or-more restrictive
 * request, so calling this twice, or calling it after a server reconciliation
 * already landed `minor`, changes nothing.
 *
 * Deliberately NOT auto-run at import time. `clock.ts`'s own module state
 * (`tier`, defaulting to `"unverified"`) is process-global, and an import-time
 * side effect would make importing this module for its TYPES or constants
 * (as a Meera file doing so by accident, or a test) silently restrict a
 * session that never asked to be. The caller — the Gurukul app shell, at the
 * same place it calls `startSessionClock` — decides when this fires.
 */
export function applyStudentSurfaceDefault(): void {
  if (!isGurukulStudentSurface()) return;
  void setAgeTier(STUDENT_SURFACE_DEFAULT_TIER);
}
