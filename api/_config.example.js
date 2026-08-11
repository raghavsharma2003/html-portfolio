// Copy to _config.js and fill in — _config.js is gitignored and must never be
// committed. Vercel deploys include it; the repo does not. Environment
// variables take priority where a route checks for them.
//
// In CI this file is GENERATED from repository secrets by
// scripts/write-config.mjs — if you add a key here, add it there too, or the
// deployed site will have it locally and not in production, which fails in the
// one place nobody is watching.
//
// OPENROUTER_KEY and NEON_URL are required: without them she has no brain and
// no memory. Everything else degrades rather than breaks.

export const OPENROUTER_KEY = "";

// Her memory lives here (Neon Postgres over SQL-over-HTTP, see api/_db.js).
export const NEON_URL = "";

// Auth + photo storage only.
export const SUPABASE_URL = "";
export const SUPABASE_KEY = "";

// FREE-TIER Google AI Studio keys. The pool is spent before any paid provider
// — see api/_gkeys.js. Measured 2026-08-11: this is a DAILY budget, and a real
// day of use exhausts it, so treat a full pool as a bonus rather than a plan.
export const GOOGLE_KEYS = [];
// Kept for compatibility; folded into the pool above when set.
export const GOOGLE_KEY = "";

// A BILLED Google key. Optional, and the difference between ~600ms and ~2s to
// first audio once the free pool is spent: it is the same streaming endpoint,
// it simply never 429s. The tier below it (OpenRouter) cannot stream at all.
// Tried last in the rotation and never cooled.
export const GOOGLE_PAID_KEY = "";

// Azure OpenAI — memory extraction only, on the startup credits.
export const AZURE_KEY = "";
export const AZURE_ENDPOINT = "";
