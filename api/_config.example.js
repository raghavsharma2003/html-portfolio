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

// ── the Telegram surface (api/tg.js, PROPOSAL-MULTIPARTY-V1 §6) ───────────
//
// TELEGRAM_BOT_TOKEN — BotFather's token for the bot. It is the only
// credential that can post as her, so it appears in exactly one expression in
// this repo (tgCall in api/tg.js) and in no log line.
//
// TELEGRAM_WEBHOOK_SECRET — the `secret_token` passed to setWebhook. Telegram
// then sends it back as the X-Telegram-Bot-Api-Secret-Token header on every
// update, and it is the ONLY thing between the webhook and an anonymous POST
// that could forge a room, a member, or an admin promotion. api/tg.js refuses
// every request when this is unset: a webhook that defaults open is a webhook
// that is open. Generate it as 64 random hex chars; it is not a password
// anyone types.
export const TELEGRAM_BOT_TOKEN = "";
export const TELEGRAM_WEBHOOK_SECRET = "";
// Not a secret — the bot's @username, used to build the deep links and to
// detect an @-mention. Kept in env rather than hard-coded so a second bot
// (staging) does not need a code change.
export const TELEGRAM_BOT_USERNAME = "";
