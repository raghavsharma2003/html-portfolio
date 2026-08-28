import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bicep = readFileSync(
  resolve(ROOT, "services/voice-eval-security/infra/main.bicep"),
  "utf8",
);

const checks = [
  ["HMAC input is a secure parameter", /@secure\(\)[\s\S]*param transportHmacSecret string/.test(bicep)],
  ["secret value is never an output", !/output\s+\w+\s+string\s*=\s*transportHmacSecret/.test(bicep)],
  ["identity and vault are dedicated", bicep.includes("vyakti-voice-eval-id") && bicep.includes("voice-evaluation-security")],
  ["vault uses access policies because deployer cannot assign RBAC", bicep.includes("enableRbacAuthorization: false")],
  ["identity and operator can only get the one vault's secrets", (bicep.match(/secrets:\s*\[\s*'get'\s*\]/g) || []).length === 2 && (bicep.match(/keys:\s*\[\]/g) || []).length === 2 && (bicep.match(/certificates:\s*\[\]/g) || []).length === 2],
  ["operator access is explicit rather than inferred from Contributor", bicep.includes("param operatorObjectId string") && bicep.includes("objectId: operatorObjectId")],
  ["only the versioned secret URI leaves the template", bicep.includes("transportSecret.properties.secretUriWithVersion")],
  ["resources are evaluation-only and expire", bicep.includes("evaluation_only: 'true'") && bicep.includes("expiry_at: explicitExpiry")],
  ["soft delete is bounded and irreversible purge protection is not enabled", bicep.includes("softDeleteRetentionInDays: 7") && !bicep.includes("enablePurgeProtection: true")],
];

for (const [name, passed] of checks) {
  assert.equal(passed, true, name);
  console.log(`PASS ${name}`);
}
console.log(`\n${checks.length}/${checks.length} voice evaluation security checks passed.`);
