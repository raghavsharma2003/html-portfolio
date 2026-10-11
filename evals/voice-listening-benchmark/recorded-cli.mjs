import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { canonical, sha256 } from "./lib.mjs";
import { ingestRecordedPack, readRecordedMedia, recordedPublicSummary, unavailableRecordedVerifier, validateRecordedPlan } from "./recorded-pack.mjs";

const fail = (code) => { throw new Error(`recorded_${code}`); };
function inputJson(path) {
  try {
    if (statSync(path).size > 2_000_000) fail("input_too_large");
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.message?.startsWith("recorded_")) throw error;
    fail("input_unavailable_or_invalid");
  }
}
function argumentsFor(command, args) {
  const allow = command === "recorded-prepare" ? ["home", "plan"]
    : command === "recorded-ingest" ? ["home", "pack", "media-root"] : command === "recorded-verify" ? ["home"] : [];
  if (!allow.length) fail("command_invalid");
  const flags = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]?.slice(2), value = args[index + 1];
    if (!args[index]?.startsWith("--") || !allow.includes(flag) || flags.has(flag) || !value || value.startsWith("--")) fail("flags_invalid");
    flags.set(flag, resolve(value));
  }
  if (allow.some((flag) => !flags.has(flag))) fail("flags_required");
  return flags;
}
function verifyPrepared(home) {
  const file = join(home, "private", "recorded-run.json");
  const saved = inputJson(file);
  if (saved.contract !== "vyakti-recorded-preparation/v1" || typeof saved.runSecret !== "string" || !/^[0-9a-f]{64}$/u.test(saved.runSecret)
    || saved.pack !== null || Object.keys(saved).sort().join() !== ["contract", "runSecret", "plan", "planSha256", "pack"].sort().join()) fail("prepared_contract_invalid");
  const validated = validateRecordedPlan(saved.plan);
  if (saved.planSha256 !== validated.planSha256) fail("prepared_plan_drift");
  const expected = { ...recordedPublicSummary(validated, Buffer.from(saved.runSecret, "hex")), privateSha256: sha256(readFileSync(file)) };
  if (canonical(inputJson(join(home, "served", "manifest.json"))) !== canonical(expected)) fail("prepared_public_drift");
  return saved;
}

// Deliberately no verifier option, environment toggle, plugin import or test mode.
// Preparing/reading a declaration does not turn it into protected voice evidence.
export async function runRecordedCommand(command, args) {
  const flags = argumentsFor(command, args), home = flags.get("home");
  if (command === "recorded-prepare") {
    const validated = validateRecordedPlan(inputJson(flags.get("plan")));
    if (existsSync(home)) fail("home_already_exists");
    const secret = randomBytes(32);
    const privateBytes = Buffer.from(JSON.stringify({ contract: "vyakti-recorded-preparation/v1", runSecret: secret.toString("hex"),
      plan: validated.plan, planSha256: validated.planSha256, pack: null }, null, 2));
    const summary = { ...recordedPublicSummary(validated, secret), privateSha256: sha256(privateBytes) };
    mkdirSync(dirname(home), { recursive: true });
    mkdirSync(home); // Exclusive directory creation prevents replacing a prepared run.
    mkdirSync(join(home, "private"), { mode: 0o700 }); mkdirSync(join(home, "served"));
    writeFileSync(join(home, "private", "recorded-run.json"), privateBytes, { flag: "wx", mode: 0o600 });
    writeFileSync(join(home, "served", "manifest.json"), JSON.stringify(summary, null, 2), { flag: "wx" });
    console.log(`recorded plan prepared: ${validated.plan.attempts.length} declared attempts; not_started; authority unverified; no media read or playback`);
    return summary;
  }
  const saved = verifyPrepared(home);
  if (command === "recorded-verify") {
    console.log("recorded preparation commitments verified; not_started; no media or speaker authority verified");
    return { state: "not_started", authorityStatus: "unverified" };
  }
  // Remains unavailable until an independently reviewed authority/protection
  // adapter exists. It refuses before media reads and before any pack write.
  return ingestRecordedPack(saved.plan, inputJson(flags.get("pack")), {
    readMedia: (descriptor) => readRecordedMedia(flags.get("media-root"), descriptor),
    verifyEvidence: unavailableRecordedVerifier,
  });
}
