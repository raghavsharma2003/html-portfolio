// Focused contract for the owner-facing Meet voice preview.
//
// This is deliberately a source-and-shape test rather than a component mock.
// The runtime behavior lives in evals/voicepanel.mjs; this suite holds the UI
// promises that are easy to regress while polishing: three truthful language
// choices over two real API language ids, an honest cold-start state, a
// correction loop, and the exact self-test surface hiding ceremony without
// weakening the protected audio receipt.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PANEL_PATH = join(ROOT, "src/studio/VoicePreviewPanel.tsx");
const API_PATH = join(ROOT, "src/studio/voicePanelApi.ts");
const APP_PATH = join(ROOT, "src/studio/StudioApp.tsx");
const CSS_PATH = join(ROOT, "src/studio/studio.css");

const panel = readFileSync(PANEL_PATH, "utf8");
const api = readFileSync(API_PATH, "utf8");
const app = readFileSync(APP_PATH, "utf8");
const css = readFileSync(CSS_PATH, "utf8");

let passed = 0;
function check(label, condition, detail = "") {
  if (!condition) {
    console.error(`FAIL  ${label}${detail ? `: ${detail}` : ""}`);
    process.exitCode = 1;
    return;
  }
  passed += 1;
  console.log(`PASS  ${label}`);
}

function findings(panelSource, apiSource, appSource, cssSource) {
  const issues = [];
  if (!/type PreviewLanguage = "hi" \| "hi-latn" \| "en"/.test(panelSource)) issues.push("three-language-ui");
  if (!/hi: "[\u0900-\u097f]/u.test(panelSource) || !/"hi-latn": "Namaste!/.test(panelSource)) issues.push("script-matched-defaults");
  if (!/language === "en" \? "en" : "hi"/.test(panelSource)) issues.push("api-language-binding");
  if (!/lang=\{selectedLanguage\.inputLanguage\}/.test(panelSource)) issues.push("input-language-semantics");
  if (!/onClick=\{\(\) => \{ if \(!reason\) void run\(0\); \}\}/.test(panelSource) || /onPointerDown=/.test(panelSource)) issues.push("semantic-generate-action");
  if (!/etaSecondsLow/.test(panelSource) || !/etaSecondsHigh/.test(panelSource) || !/\{remaining\}s/.test(panelSource)) issues.push("honest-warmup-range");
  if (/<progress\b|role="progressbar"/i.test(panelSource)) issues.push("fake-progress");
  if (!/writePersistedWarmup/.test(panelSource) || !/readPersistedWarmup/.test(panelSource)) issues.push("reload-safe-warmup");
  if (!/Not right yet\?/.test(panelSource) || !/Edit the line/.test(panelSource) || !/Generate another take/.test(panelSource)) issues.push("correction-loop");
  if (!/!testEnvironment && <dl className="hear-voice-proof"/.test(panelSource)) issues.push("self-test-ceremony-hidden");
  if (!/disclosure !== "audible-prefix-v1"/.test(apiSource) || !/x-vyakti-text-plan/.test(apiSource)) issues.push("protected-receipt-required");
  if (!/!testEnvironment && <ReadinessStrip/.test(appSource) || !/!testEnvironment && <Band[\s\S]*title="Prove it is you"/.test(appSource)) issues.push("self-test-compliance-removed");
  if (!/\.hear-voice \.voice-preview-language \{ grid-template-columns: repeat\(3/.test(cssSource)) issues.push("language-control-layout");
  if (!cssSource.includes(".hear-voice-wait-metrics, .hear-voice-correction { grid-template-columns: 1fr; }")) issues.push("mobile-correction-layout");
  if (!/\.hear-voice-stage-ready \{[^}]*background: var\(--forest-deep\)/.test(cssSource)) issues.push("ready-state-material");
  if (/best|winner|indistinguishable|state.of.the.art/i.test(panelSource)) issues.push("unmeasured-quality-claim");
  return issues;
}

const live = findings(panel, api, app, css);
check("Meet voice UI contract is complete", live.length === 0, live.join(", "));

const negativeControls = [
  ["language control loss", panel.replace('type PreviewLanguage = "hi" | "hi-latn" | "en"', 'type PreviewLanguage = "hi" | "en"'), api, app, css, "three-language-ui"],
  ["wrong API language mapping", panel.replace('language === "en" ? "en" : "hi"', "language"), api, app, css, "api-language-binding"],
  ["pointer-only generation", panel.replace('onClick={() => { if (!reason) void run(0); }}', 'onPointerDown={() => { if (!reason) void run(0); }}'), api, app, css, "semantic-generate-action"],
  ["fake progress returns", panel.replace('<div className="hear-voice-wait-metrics"', '<progress value="50" max="100" /><div className="hear-voice-wait-metrics"'), api, app, css, "fake-progress"],
  ["correction action disappears", panel.replace("Not right yet?", "Result"), api, app, css, "correction-loop"],
  ["receipt disclosure weakens", panel, api.replace('disclosure !== "audible-prefix-v1"', "false"), app, css, "protected-receipt-required"],
  ["self-test readiness returns", panel, api, app.replace("!testEnvironment && <ReadinessStrip", "true && <ReadinessStrip"), css, "self-test-compliance-removed"],
  ["mobile correction rule disappears", panel, api, app, css.replace(".hear-voice-wait-metrics, .hear-voice-correction { grid-template-columns: 1fr; }", ".hear-voice-wait-metrics { grid-template-columns: 1fr; }"), "mobile-correction-layout"],
];

for (const [label, panelSource, apiSource, appSource, cssSource, expected] of negativeControls) {
  check(`NEGATIVE CONTROL: ${label} is caught`, findings(panelSource, apiSource, appSource, cssSource).includes(expected));
}

if (!process.exitCode) console.log(`\nvoice-preview-ui: ${passed} checks passed`);
