// scripts/keyring.mjs — manage the labeled Google key pool.
//
// Reads api/keyring.json (gitignored master: [{label, key}, ...]), validates
// every key against Gemini countTokens (free — no generation quota), prints a
// health table BY LABEL, and regenerates the two derived forms:
//   - api/_config.js  GOOGLE_KEYRING  (local dev + evals)
//   - api/google-keys.env  GOOGLE_KEYS=label~key,...  (paste into Vercel)
//
// Never prints a key. See docs/KEYRING.md. Run: node scripts/keyring.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = join(ROOT, "api", "keyring.json");
const CONFIG = join(ROOT, "api", "_config.js");
const ENVOUT = join(ROOT, "api", "google-keys.env");
const MODEL = "gemini-3.6-flash";
const validateOnly = process.argv.includes("--check");

if (!existsSync(MASTER)) {
  console.error(`no ${MASTER} — create it: [{ "label": "owner", "key": "AQ..." }, ...]`);
  process.exit(1);
}
const ring = JSON.parse(readFileSync(MASTER, "utf8")).filter(
  (r) => typeof r?.key === "string" && r.key.length > 20,
);
const dupes = ring.map((r) => r.key).filter((k, i, a) => a.indexOf(k) !== i);
if (dupes.length) console.log(`note: ${dupes.length} duplicate key(s) will collapse to one in the pool`);

async function health(r) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:countTokens?key=${r.key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] }),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (res.ok) return { label: r.label, ok: true };
    const j = await res.json().catch(() => ({}));
    return { label: r.label, ok: false, why: `${res.status} ${j?.error?.status || ""}` };
  } catch (e) {
    return { label: r.label, ok: false, why: e.message.slice(0, 40) };
  }
}

console.log(`validating ${ring.length} keys against ${MODEL} countTokens (free)...`);
const results = [];
for (let i = 0; i < ring.length; i += 8) {
  results.push(...(await Promise.all(ring.slice(i, i + 8).map(health))));
}
const healthy = results.filter((r) => r.ok);
console.log(`\nHEALTHY: ${healthy.length}/${results.length}`);
for (const r of results.filter((r) => !r.ok)) console.log(`  DEAD  ${r.label} — ${r.why}`);

if (validateOnly) process.exit(healthy.length === results.length ? 0 : 1);

// Regenerate GOOGLE_KEYRING in _config.js
let cfg = readFileSync(CONFIG, "utf8");
cfg = cfg.replace(/\nexport const GOOGLE_KEYRING = .*?;\n/s, "\n");
writeFileSync(CONFIG, cfg.trimEnd() + "\nexport const GOOGLE_KEYRING = " + JSON.stringify(ring) + ";\n");
// Regenerate the Vercel env string
writeFileSync(ENVOUT, "GOOGLE_KEYS=" + ring.map((r) => `${r.label}~${r.key}`).join(",") + "\n");
console.log(`\nwrote GOOGLE_KEYRING (${ring.length}) to api/_config.js and GOOGLE_KEYS to api/google-keys.env`);
console.log("paste api/google-keys.env's value into the Vercel project env, then redeploy.");
