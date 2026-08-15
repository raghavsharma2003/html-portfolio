#!/usr/bin/env node
// WS-MANIFEST Phase D prep — SPEC.md §7.3 "chat lane call-site adoption":
// "the returned model must equal today's hardcoded choice, asserted in a
// fixture." Proves THREE things must agree, all against the REAL source
// (bundled with esbuild, never hand-copied):
//
//   1. router.ts's route() run against the REAL config/models.json chat lane
//      returns google/gemini-3.6-flash (the incumbent, zero candidates today).
//   2. brain.ts's routeChatLane() — the actual call-site — returns the same
//      model. This is the thing that matters: it proves the hand-kept mirror
//      (CHAT_LANE_MODELS/CHAT_LANE_CONFIG in brain.ts, kept in sync by hand
//      with config/models.json because brain.ts ships in the browser bundle
//      and cannot `import ... with { type: "json" }` the way api/route.js
//      and scripts/derive-adapter.mjs do) has not drifted from the real seed.
//   3. Both equal brain.ts's own OPENROUTER_DEFAULT_MODEL constant — the
//      literal hardcoded value every chat/call turn sent before this seam
//      existed. Byte-string equality, not "close enough".
//
// Run: node scripts/verify-chat-lane-route.mjs
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "node_modules", ".chat-lane-route-verify");
const BUNDLE = join(OUT, "entry.mjs");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

execSync(
  `npx esbuild ${join(ROOT, "src/engine/__fixtures__/.router-chat-entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);

const { OPENROUTER_DEFAULT_MODEL, routeChatLane, CHAT_LANE_MODELS, CHAT_LANE_CONFIG, route } = await import(BUNDLE);
const seed = (await import(join(ROOT, "config", "models.json"), { with: { type: "json" } })).default;

let failed = false;
const report = (ok, label, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed = true;
};

console.log("── verify-chat-lane-route.mjs — SPEC §7.3 chat-lane call-site adoption proof ──\n");

// ── 1. router.ts's route(), against the REAL config/models.json ──────────
const seedDecision = route("chat", seed.lanes.chat, seed.models)[0];
report(
  Boolean(seedDecision),
  "router.route('chat', config/models.json's real chat lane) returns a candidate",
  seedDecision ? `${seedDecision.model} (${seedDecision.role})` : "empty",
);
report(
  seedDecision?.model === OPENROUTER_DEFAULT_MODEL,
  "route() over config/models.json === OPENROUTER_DEFAULT_MODEL",
  `${seedDecision?.model} === ${OPENROUTER_DEFAULT_MODEL}`,
);

// ── 2. brain.ts's actual call-site function ───────────────────────────────
const brainDecision = routeChatLane();
report(
  brainDecision.model === OPENROUTER_DEFAULT_MODEL,
  "brain.ts's routeChatLane() === OPENROUTER_DEFAULT_MODEL",
  `${brainDecision.model} === ${OPENROUTER_DEFAULT_MODEL}`,
);
report(brainDecision.role === "incumbent", "brain.ts's routed decision has role 'incumbent'", brainDecision.role);
report(brainDecision.gate === "passed", "brain.ts's routed decision has gate 'passed'", brainDecision.gate);

// ── 3. no drift between brain.ts's hand-kept mirror and the real seed ────
report(
  CHAT_LANE_CONFIG.incumbent === seed.lanes.chat.incumbent,
  "brain.ts CHAT_LANE_CONFIG.incumbent === config/models.json lanes.chat.incumbent",
  `${CHAT_LANE_CONFIG.incumbent} === ${seed.lanes.chat.incumbent}`,
);
report(
  JSON.stringify(CHAT_LANE_CONFIG.candidates) === JSON.stringify(seed.lanes.chat.candidates),
  "brain.ts CHAT_LANE_CONFIG.candidates === config/models.json lanes.chat.candidates",
);
const mirrorRow = CHAT_LANE_MODELS[OPENROUTER_DEFAULT_MODEL];
const seedRow = seed.models[OPENROUTER_DEFAULT_MODEL];
for (const field of ["gate", "card_risk", "prefix_cache", "billing", "provider"]) {
  report(mirrorRow[field] === seedRow[field], `mirror.${field} === seed.${field}`, `${mirrorRow[field]} === ${seedRow[field]}`);
}

console.log(
  failed
    ? "\nFAIL — chat lane's routed model does NOT provably equal today's hardcoded choice."
    : `\nPASS — router.route() for Lane "chat", brain.ts's call-site adoption, and today's hardcoded ` +
        `OPENROUTER_DEFAULT_MODEL (${OPENROUTER_DEFAULT_MODEL}) all agree. Behavior unchanged, proven, not assumed.`,
);
process.exit(failed ? 1 : 0);
