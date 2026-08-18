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

writeFileSync(OUT, lines.join("\n") + "\n");

console.log(`wrote api/_config.js`);
console.log(`  present: ${present.join(", ") || "(none)"}`);
if (missing.length) console.log(`  MISSING: ${missing.join(", ")}`);

// The site cannot function without these two: no OpenRouter key means she has
// no brain and no voice fallback, no Neon URL means no memory at all. Failing
// here is much cheaper than deploying a site that looks fine and answers 500.
for (const required of ["OPENROUTER_KEY", "NEON_URL"]) {
  if (!process.env[required]) {
    console.error(`::error::${required} is required and was not set — refusing to deploy.`);
    process.exit(1);
  }
}
