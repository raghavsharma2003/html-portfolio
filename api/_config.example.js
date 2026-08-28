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
// Required only for the private replica bucket. It is deliberately distinct
// from SUPABASE_KEY: biometric storage never guesses that a general app key is
// privileged. Replica enrollment fails closed when this is absent.
export const SUPABASE_SERVICE_ROLE_KEY = "";

// FREE-TIER Google AI Studio keys. The pool is spent before any paid provider
// — see api/_gkeys.js. Measured 2026-08-11: this is a DAILY budget, and a real
// day of use exhausts it, so treat a full pool as a bonus rather than a plan.
export const GOOGLE_KEYS = [];
// Kept for compatibility; folded into the pool above when set.
export const GOOGLE_KEY = "";
// The LABELED pool, for RCA: [{ label, key }, ...] where label is the owner tag
// ("gaurav-3", "team@x.world") — never a secret, names WHOSE key. Preferred over
// GOOGLE_KEYS locally; the trace records which label served each turn. In the
// Vercel env, use GOOGLE_KEYS="label~key,label~key,..." instead. Managed by
// scripts/keyring.mjs from api/keyring.json (both gitignored). See docs/KEYRING.md.
export const GOOGLE_KEYRING = [];

// A BILLED Google key. Optional, and the difference between ~600ms and ~2s to
// first audio once the free pool is spent: it is the same streaming endpoint,
// it simply never 429s. The tier below it (OpenRouter) cannot stream at all.
// Tried last in the rotation and never cooled.
export const GOOGLE_PAID_KEY = "";

// ── WS-COST: the billed Google CHAT lane ─────────────────────────────────
//
// GEMINI_PAID_KEY is a prepaid Google AI Studio key. GOOGLE_PAID_KEY above is
// the VOICE lane's billed key and is a separate slot on purpose: the two lanes
// have different failure modes and different budgets, and one key doing two
// jobs is `one-key-two-jobs`.
//
// PAID_LANE is the switch, and it is OFF unless it is the string "1" or
// "true" (env `PAID_LANE` wins over this file, so it can be flipped in Vercel
// without redeploying the gitignored config). With it off, api/chat.js's
// ladder is the exact frozen array it was before this lane existed —
// gemini-free > openrouter > azure — and no request can reach a billed Google
// key by accident. With it on, and only if a key is present, the order becomes
// gemini-free > gemini-paid > openrouter > azure (see LANE_ORDER_TEXT_PAID in
// api/_lanes.js).
//
// What it costs, measured 2026-08-25 on gemini-3.6-flash at Google list
// ($0.75/1M in, $0.075/1M cached-in, $3.75/1M out): ~$0.0101 per chat turn
// uncached, ~$0.0046 on an implicit-cache hit (8,165 of ~13,400 input tokens,
// 60.7%, hit on 16 of 19 follow-up calls). Implicit caching is automatic and
// needs no request field — the `cache_control` marker api/chat.js sends is an
// Anthropic-shaped hint that Google ignores, measured identical with and
// without it.
//
// WS-COST C added the measured cost path on top of that lane: an explicit
// Google `cachedContents` object over the byte-stable CORE (12,097 of ~13,400
// input tokens), so a follow-up turn bills the cached rate on 90% of its input
// instead of the implicit cache's 60.7% plateau — ~$0.0101 → ~$0.0021 per turn
// including cache storage, −79.2% (measurements.md#cache-plateau). It runs
// INSIDE the paid lane only and on Google's native surface (the compat
// endpoint has no field for a cache), and every failure in it falls back to
// the plain paid call within the same turn.
//
// PAID_CACHE is its opt-out and the polarity is deliberately the opposite of
// PAID_LANE: it cannot cause spend, only change the shape of spend the paid
// lane already authorised, so it is ON unless it is "0", "false" or "off".
// Set it off to put the paid lane back on the plain compat call without a
// deploy.
export const GEMINI_PAID_KEY = "";
export const PAID_LANE = "";
export const PAID_CACHE = "";

// Azure AI Foundry, on the Microsoft-for-Startups credits — $0 cash.
//
// Three jobs now, not one:
//   1. memory extraction + embeddings (api/memory.js, api/_embed.js,
//      api/consolidate.js) — the original use.
//   2. THE LAST-RESORT BRAIN (api/_azure.js, reached from api/chat.js after the
//      free Google pool and after OpenRouter). On 2026-08-24 the free pool
//      aborted on one 502 and the OpenRouter balance was spent, and with
//      nothing underneath them she sent the canned connectivity line three
//      times in ninety minutes. This lane is what stops that.
//   3. THE FIRST lane for images and documents, by the owner's directive — see
//      LANE_ORDER_ATTACHMENT in api/_lanes.js.
//
// AZURE_ENDPOINT is the openai/v1-compatible base INCLUDING the /openai/v1
// suffix and with no trailing slash. Env overrides, mirroring what memory.js
// and _embed.js already read: AZURE_ENDPOINT and AZURE_API_KEY (note the
// asymmetry — the config name is AZURE_KEY, the env name is AZURE_API_KEY).
// Unset means the lane reports itself unconfigured and is skipped; nothing
// breaks, she just loses her third brain.
export const AZURE_KEY = "";
export const AZURE_ENDPOINT = "";
// Optional deployment names for the brain lane. Both default to
// `grok-4-20-non-reasoning` — the one deployment on this resource that
// config/models.json records as gate-passed for the vision lane (vy_gate_run
// id 35). Env only, no config entry needed:
//   AZURE_CHAT_DEPLOYMENT     text last resort
//   AZURE_VISION_DEPLOYMENT   images and documents

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

// ── the push slot (api/push-token.js, api/_push.js, src/notify/) ──────────
//
// ALL THREE EMPTY IS THE SHIPPING STATE and everything downstream no-ops:
// api/push-token.js answers 200 { stored: false } without touching the
// database, api/_push.js returns { sent: 0, reason: "unconfigured" } without a
// fetch, and the client never registers a service worker or asks for a token.
// Local notifications (her reply, a missed call, her story) do not read any of
// this and work with none of it.
//
// These are the SERVER half of a Firebase service account — the half that can
// actually send, which is why it lives here and not in the committed
// src/notify/config.ts (that file holds the public web config). Get them from
// Firebase console -> Project settings -> Service accounts -> "Generate new
// private key", which downloads a JSON file:
//
//   FCM_PROJECT_ID   = <project_id>
//   FCM_CLIENT_EMAIL = <client_email>
//   FCM_PRIVATE_KEY  = <private_key>, with its \n escapes left exactly as they
//                      are in the JSON. api/_push.js un-escapes them; a key
//                      pasted with real newlines through an environment
//                      variable is the usual way this fails, and it fails as
//                      "DECODER routines::unsupported", which reads like a
//                      corrupt key rather than a formatting one.
//
// FCM_PRIVATE_KEY is a signing key: it appears in exactly one expression in
// this repo (accessToken() in api/_push.js) and in no log line, the same rule
// TELEGRAM_BOT_TOKEN states above.
export const FCM_PROJECT_ID = "";
export const FCM_CLIENT_EMAIL = "";
export const FCM_PRIVATE_KEY = "";
