// Rebuild api/_config.js from environment variables, for CI.
//
// api/_config.js holds every key and is gitignored, so a CI checkout does not
// have it — but the Vercel deploy payload needs it or every API route returns
// 500. This writes it from secrets at deploy time and nowhere else.
//
// It NEVER prints a value. The only output is which names were found and which
// were missing, because a deploy that silently ships without a key is the
// failure this is meant to prevent, and a log that leaks one is worse than the
// failure.
import { writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "api", "_config.js");

// GOOGLE_KEYS is a JSON array; everything else is a plain string. Getting that
// wrong yields a pool of one key whose "length" is the character count.
const STRINGS = [
  "OPENROUTER_KEY",
  // #89 CREDENTIALS SPLIT (docs/CREDENTIALS.md). Research and production
  // share one OpenRouter budget today; this is the optional second key that
  // separates them. OPTIONAL — not in the required-keys check below — so a
  // deploy never fails for lacking it. Name-only wiring: the owner adds the
  // actual second key later.
  "OPENROUTER_RESEARCH_KEY",
  "GOOGLE_KEY",
  "GOOGLE_PAID_KEY",
  "NEON_URL",
  "SUPABASE_URL",
  "SUPABASE_KEY",
  "AZURE_KEY",
  "AZURE_ENDPOINT",
  // The Telegram surface (api/tg.js). TELEGRAM_WEBHOOK_SECRET is the only
  // thing authenticating the webhook — api/tg.js refuses every update when it
  // is unset, so a deploy without it is a bot that receives nothing rather
  // than a bot that trusts anyone. TELEGRAM_BOT_USERNAME is not a secret; it
  // rides the same rail because it is per-bot config and a staging bot must
  // not need a code change.
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_BOT_USERNAME",
  // The push slot (api/push-token.js, api/_push.js). OPTIONAL — not in the
  // required-keys check — so a deploy never fails for lacking them, which is
  // the shipping state: with these absent the whole push lane no-ops and local
  // notifications are unaffected. Listed here at the same time as the code
  // that reads them, because a key that exists locally and not in production
  // fails in the one place nobody is watching.
  "FCM_PROJECT_ID",
  "FCM_CLIENT_EMAIL",
  "FCM_PRIVATE_KEY",
];

// Refusing to overwrite a real local config is not politeness — running this
// by hand in a checkout that HAS the keys would destroy them, and they are not
// recoverable from the repo.
if (existsSync(OUT) && !process.env.CI) {
  console.error("api/_config.js already exists and CI is not set — refusing to overwrite.");
  process.exit(1);
}

const lines = [
  "// GENERATED AT DEPLOY TIME from CI secrets by scripts/write-config.mjs.",
  "// Not a source file: edit the secrets, not this.",
  "",
];
const present = [];
const missing = [];

for (const name of STRINGS) {
  const v = process.env[name];
  if (v) {
    present.push(name);
    lines.push(`export const ${name} = ${JSON.stringify(v)};`);
  } else {
    missing.push(name);
    lines.push(`export const ${name} = "";`);
  }
}

let keys = [];
if (process.env.GOOGLE_KEYS) {
  try {
    const parsed = JSON.parse(process.env.GOOGLE_KEYS);
    if (Array.isArray(parsed)) keys = parsed.filter((k) => typeof k === "string" && k.length > 20);
  } catch {
    // a newline- or comma-separated list is the shape a human actually pastes
    keys = process.env.GOOGLE_KEYS.split(/[\s,]+/).filter((k) => k.length > 20);
  }
}
if (keys.length) present.push(`GOOGLE_KEYS(${keys.length})`);
else missing.push("GOOGLE_KEYS");
lines.push(`export const GOOGLE_KEYS = ${JSON.stringify(keys)};`);

// #89 CREDENTIALS SPLIT (docs/CREDENTIALS.md): resolve OPENROUTER_RESEARCH_KEY
// once, here, rather than scattering a fallback across every research script.
// If the owner has not set the dedicated key yet, research scripts that import
// OPENROUTER_RESEARCH_KEY get the shared OPENROUTER_KEY value transparently —
// same behavior as today — but the fallback is PRINTED (never-scheduled's
// sibling law, `silent-truncation`: a silent fallback is how a "split" budget
// quietly stays one budget forever without anyone noticing).
let researchFallback = false;
if (!process.env.OPENROUTER_RESEARCH_KEY && process.env.OPENROUTER_KEY) {
  researchFallback = true;
  const i = lines.findIndex((l) => l.startsWith("export const OPENROUTER_RESEARCH_KEY"));
  lines[i] = `export const OPENROUTER_RESEARCH_KEY = ${JSON.stringify(process.env.OPENROUTER_KEY)}; // fallback: OPENROUTER_RESEARCH_KEY unset, see docs/CREDENTIALS.md`;
}

writeFileSync(OUT, lines.join("\n") + "\n");

console.log(`wrote api/_config.js`);
console.log(`  present: ${present.join(", ") || "(none)"}`);
if (missing.length) console.log(`  MISSING: ${missing.join(", ")}`);
if (researchFallback) {
  console.log(
    "  WARNING: OPENROUTER_RESEARCH_KEY not set — research scripts fall back to the shared OPENROUTER_KEY budget (docs/CREDENTIALS.md).",
  );
}

// ── --stub ────────────────────────────────────────────────────────────────
// A gate job needs this file to EXIST and needs no key in it.
//
// `api/_db.js` imports NEON_URL at module scope, so `api/_trace.js` does too,
// so `evals/trace/run.mjs` does — and that suite is deliberately structural
// with no database in it. Without this file the import fails to resolve and
// the WHOLE eval suite dies before it reaches the persona invariants. That is
// exactly why the suite has never run in CI: it could not.
//
// A stub is the honest fix rather than a mocked module. Every value is the
// empty string, so nothing is granted, and an accidental query against an
// empty NEON_URL fails loudly instead of quietly reaching production. The
// deploy guard below is skipped because there is nothing to deploy.
if (process.argv.includes("--stub")) {
  console.log("  (--stub: no keys, gate use only — this build cannot deploy or reach the DB)");
  process.exit(0);
}

// The site cannot function without these two: no OpenRouter key means she has
// no brain and no voice fallback, no Neon URL means no memory at all. Failing
// here is much cheaper than deploying a site that looks fine and answers 500.
for (const required of ["OPENROUTER_KEY", "NEON_URL"]) {
  if (!process.env[required]) {
    console.error(`::error::${required} is required and was not set — refusing to deploy.`);
    process.exit(1);
  }
}
