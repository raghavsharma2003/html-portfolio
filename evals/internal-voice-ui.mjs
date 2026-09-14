import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const panel = readFileSync(join(root, "src/studio/InternalVoicePanel.tsx"), "utf8");
const api = readFileSync(join(root, "src/studio/internalVoiceApi.ts"), "utf8");
const shell = readFileSync(join(root, "src/studio/CloneExperience.tsx"), "utf8");
const fixture = readFileSync(join(root, "src/studio/layoutFixture.tsx"), "utf8");
const panelCss = readFileSync(join(root, "src/studio/internal-voice-panel.css"), "utf8");
let passed = 0;

function check(name, value) {
  if (!value) throw new Error(name);
  passed += 1;
  console.log(`PASS  ${name}`);
}

function findings(panelSource, apiSource, shellSource, fixtureSource, cssSource) {
  const issues = [];
  const beforeGenerateAction = panelSource.slice(0, panelSource.indexOf("async function generate()"));
  if (!/lazy\(\(\) => import\("\.\/InternalVoicePanel"\)\)/.test(shellSource)
      || !/<InternalVoicePanel token=\{accessToken\} replicaId=\{selected\.replica_id\}/.test(shellSource)) issues.push("actual-meet-mount");
  if (!/Authorization: `Bearer \$\{token\}`/.test(apiSource)
      || !/\/api\/internal-voice/.test(apiSource)) issues.push("bearer-api");
  if (!/hideUnavailable && cause instanceof InternalVoiceApiError && cause\.status === 404/.test(panelSource)
      || !/setAvailability\("hidden"\)/.test(panelSource)) issues.push("disabled-hidden");
  if (!/crypto\.randomUUID\(\)/.test(panelSource)
      || !/action: "generate"/.test(apiSource)) issues.push("explicit-generate");
  if (!/window\.setTimeout\(\(\) => void loadStatus\(run\.run_id\), 3000\)/.test(panelSource)
      || !/statusPath\(replicaId, runId\)/.test(apiSource)) issues.push("same-run-poll");
  if (!/const audioRunId = status\?\.run\?\.run_id/.test(panelSource)
      || !/fetchInternalVoiceAudio\(token, replicaId, audioRunId, "audio"/.test(panelSource)
      || !/URL\.createObjectURL/.test(panelSource) || !/URL\.revokeObjectURL/.test(panelSource)
      || !/content-type/.test(apiSource) || !/audio\/wav/.test(apiSource)) issues.push("authenticated-wav-blob");
  if (!/"owner_likeness", "naturalness", "indian_accent", "pronunciation"/.test(panelSource)
      || !/\[1, 2, 3, 4, 5\]/.test(panelSource) || !/action: "rate"/.test(apiSource)) issues.push("four-ratings");
  if (!/const savedRatings = run\?\.ratings/.test(panelSource)
      || !/savedRatings \? <section/.test(panelSource)) issues.push("saved-rating-readonly");
  if (!/run\?\.state === "failed" \|\| run\?\.state === "unknown"/.test(panelSource)
      || !/terminalRetry \? <button[^>]+onClick=\{\(\) => void loadStatus\(run\.run_id\)\}/.test(panelSource)) issues.push("honest-terminal-state");
  if (!/action: "revoke"/.test(apiSource) || !/>\{copy\.cancel\}<\/button>/.test(panelSource)
      || !/>\{copy\.revoke\}<\/button>/.test(panelSource)) issues.push("cancel-revoke");
  if (/generateInternalVoice\(/.test(beforeGenerateAction)
      || !/onClick=\{\(\) => void generate\(\)\}/.test(panelSource)) issues.push("no-auto-synthesis");
  if (!/[\u0900-\u097f]/u.test(panelSource) || !/Your voice, in Hindi/.test(panelSource)) issues.push("bilingual-copy");
  if (/identity_scope.*verified|release_eligible:\s*true|verified likeness/i.test(panelSource)) issues.push("no-fake-verification");
  if (!/hideUnavailable && probeOnly/.test(panelSource)
      || !/hideUnavailable && probeOnly[\s\S]{0,180}onAvailability\?\.\(false\)/.test(panelSource)) issues.push("probe-error-stays-disabled");
  if (!/path === "\/api\/internal-voice"[\s\S]{0,140}internal_voice_disabled[\s\S]{0,30}404/.test(fixtureSource)) issues.push("fixture-disabled-default");
  if (!/className="vx-conversation-switch internal-voice-tabs"/.test(shellSource)
      || !/\.vx-conversation-switch\.internal-voice-tabs[\s\S]{0,180}repeat\(2, minmax\(0, 1fr\)\)/.test(cssSource)) issues.push("internal-two-tabs");
  return issues;
}

const live = findings(panel, api, shell, fixture, panelCss);
check(`internal voice owner UI contract is complete${live.length ? ` (${live.join(", ")})` : ""}`, live.length === 0);
const mutations = [
  ["Meet mount removed", panel, api, shell.replace('const InternalVoicePanel = lazy(() => import("./InternalVoicePanel"));', ""), fixture, panelCss, "actual-meet-mount"],
  ["bearer removed", panel, api.replaceAll("Authorization: `Bearer ${token}`", "Authorization: token"), shell, fixture, panelCss, "bearer-api"],
  ["disabled 404 becomes visible", panel.replace("hideUnavailable && cause instanceof InternalVoiceApiError && cause.status === 404", "false"), api, shell, fixture, panelCss, "disabled-hidden"],
  ["poll mints a new UUID", panel.replace("loadStatus(run.run_id)", "loadStatus(crypto.randomUUID())"), api, shell, fixture, panelCss, "same-run-poll"],
  ["ratings lose one axis", panel.replace(', "pronunciation"', ""), api, shell, fixture, panelCss, "four-ratings"],
  ["automatic synthesis call added", panel.replace("async function generate()", "generateInternalVoice(token, replicaId, crypto.randomUUID());\n  async function generate()"), api, shell, fixture, panelCss, "no-auto-synthesis"],
  ["malformed probe enables owner lane", panel.replace("hideUnavailable && probeOnly", "hideUnavailable && false"), api, shell, fixture, panelCss, "probe-error-stays-disabled"],
  ["ordinary fixture returns generic success", panel, api, shell, fixture.replace('return reply({ enabled: false, error: "internal_voice_disabled" }, 404);', "return reply({});"), panelCss, "fixture-disabled-default"],
  ["internal tabs reserve four columns", panel, api, shell, fixture, panelCss.replace("repeat(2, minmax(0, 1fr))", "repeat(4, minmax(0, 1fr))"), "internal-two-tabs"],
];
for (const [name, p, a, s, f, c, expected] of mutations) {
  check(`NEGATIVE CONTROL: ${name} is caught`, findings(p, a, s, f, c).includes(expected));
}

console.log(`\ninternal-voice-ui: ${passed} checks passed`);
