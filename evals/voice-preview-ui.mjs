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
const MOBILE_CSS_PATH = join(ROOT, "src/studio/design/mobile.css");


// WS-R166 (wave twenty-two) moved every user-visible string of the panel into
// the personal studio's copy registry (src/studio/copy.ts, the
// EN_VOICE_PREVIEW_PANEL block), so the copy-shaped assertions below read the
// panel source PLUS that one English block: the property (what the owner is
// told) is what this suite freezes, never which file carries the sentence
// (context/rejected.md#frozen-file-merge-controls-break-on-the-next-change).
function englishVoicePreviewCopy(root) {
  const source = readFileSync(join(root, "src/studio/copy.ts"), "utf8");
  const start = source.indexOf("const EN_VOICE_PREVIEW_PANEL");
  if (start < 0) throw new Error("EN_VOICE_PREVIEW_PANEL not found in src/studio/copy.ts");
  const end = source.indexOf("\n};\n", start);
  return source.slice(start, end + 4);
}
const panel = `${readFileSync(PANEL_PATH, "utf8")}\n${englishVoicePreviewCopy(ROOT)}`;
const api = readFileSync(API_PATH, "utf8");
const app = readFileSync(APP_PATH, "utf8");
const css = readFileSync(CSS_PATH, "utf8");
const mobileCss = readFileSync(MOBILE_CSS_PATH, "utf8");

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
  if (!/hi: "[\u0900-\u097f]/u.test(panelSource) || !/"hi-latn": "Namaste[.!]/.test(panelSource)) issues.push("script-matched-defaults");
  if (!/language === "en" \? "en" : "hi"/.test(panelSource)) issues.push("api-language-binding");
  if (!/lang=\{selectedLanguage\.inputLanguage\}/.test(panelSource)) issues.push("input-language-semantics");
  if (!/onClick=\{\(\) => \{ if \(!reason\) startPreview\(/.test(panelSource) || /onPointerDown=/.test(panelSource)) issues.push("semantic-generate-action");
  if (!/etaSecondsLow/.test(panelSource) || !/etaSecondsHigh/.test(panelSource) || !/\$\{remaining\} seconds|\{n\} seconds/.test(panelSource)) issues.push("honest-warmup-range");
  if (!/Elapsed/.test(panelSource) || !/Observed range/.test(panelSource) || !/Return around/.test(panelSource) || !/pendingReturnAt/.test(panelSource) || !/Next check in about/.test(panelSource)) issues.push("return-guidance");
  if (!/requestInFlightRef/.test(panelSource) || !/window\.setTimeout\(\(\) => void runIntent\(phase\.intent/.test(panelSource)) issues.push("single-retry-owner");
  if (!/navigator\.onLine/.test(panelSource) || !/window\.addEventListener\("online"/.test(panelSource) || !/request and latest server state are saved/.test(panelSource)) issues.push("offline-continuity");
  if (/<progress\b|role="progressbar"/i.test(panelSource)) issues.push("fake-progress");
  if (!/writePersistedIntent/.test(panelSource) || !/readPersistedIntent/.test(panelSource) || !/window\.localStorage/.test(panelSource) || /sessionStorage/.test(panelSource.replace(/former per-tab sessionStorage countdown/, ""))) issues.push("durable-intent-resume");
  if (!/new BroadcastChannel\(INTENT_CHANNEL\)/.test(panelSource) || !/The SQL semantic key decides/.test(panelSource)) issues.push("cross-tab-observer");
  if (!/if \(restoredRef\.current && composerDirty && activeIntentRef\.current !== signature\)/.test(panelSource) || !/Another tab started a preview while you were editing here/.test(panelSource) || !/Join that preview/.test(panelSource)) issues.push("cross-tab-draft-preserved");
  if (!/Not right yet\?/.test(panelSource) || !/Edit the line/.test(panelSource) || !/Regenerate preview/.test(panelSource) || !/crypto\.randomUUID\(\)/.test(panelSource)) issues.push("correction-loop");
  if (!/disabled=\{busy\}/.test(panelSource) || !/line and language stay locked/.test(panelSource)) issues.push("immutable-active-composer");
  if (!/role="status" aria-live="polite" aria-atomic="true"/.test(panelSource) || /hear-voice-stage[^>]*aria-live/.test(panelSource)) issues.push("quiet-live-status");
  if (!/regenerationKey\?: string/.test(apiSource) || !/regeneration_key/.test(apiSource) || !/x-vyakti-preview-intent/.test(apiSource) || !/x-vyakti-preview-reused/.test(apiSource)) issues.push("durable-api-contract");
  if (!/response\.status === 409/.test(apiSource) || !/kind: "failed"/.test(apiSource) || !/phase\.kind === "failed"/.test(panelSource) || !/This preview stopped/.test(panelSource)) issues.push("terminal-intent-recovery");
  if (!/outcome\.reused/.test(panelSource) || !/No second generation was created/.test(panelSource)) issues.push("observer-copy");
  if (!/Closing this page pauses browser checks/.test(panelSource) || !/same request resumes when you return/.test(panelSource)) issues.push("safe-leave-return");
  if (/request continues on the server|server keeps this request|work continues after (?:you )?(?:leave|close)/i.test(panelSource)) issues.push("background-work-overclaim");
  if (!/cause instanceof ReplicaApiError && cause\.status === 401/.test(panelSource) || !/onAuthError\(cause\)/.test(panelSource)) issues.push("session-expiry-resume");
  if (!/genomeVersion: intent\.genomeVersion/.test(panelSource) || !/text: intent\.text/.test(panelSource) || !/regenerationKey: intent\.regenerationKey/.test(panelSource)) issues.push("immutable-request-replay");
  if (/onClick=\{\(\) => void run\(0\)\}|>Try again<|Generate another take/.test(panelSource)) issues.push("manual-duplicate-retry");
  if (!/!testEnvironment && <dl className="hear-voice-proof"/.test(panelSource)) issues.push("self-test-ceremony-hidden");
  if (!/disclosure !== "audible-prefix-v1"/.test(apiSource) || !/x-vyakti-text-plan/.test(apiSource)) issues.push("protected-receipt-required");
  if (!/!testEnvironment && <ReadinessStrip/.test(appSource) || !/!testEnvironment && <Band[\s\S]*title="Prove it is you"/.test(appSource)) issues.push("self-test-compliance-removed");
  if (!/\.hear-voice \.voice-preview-language \{ grid-template-columns: repeat\(3/.test(cssSource)) issues.push("language-control-layout");
  if (!cssSource.includes(".hear-voice-wait-metrics, .hear-voice-correction { grid-template-columns: 1fr; }")) issues.push("mobile-correction-layout");
  if (!/\.hear-voice-stage-ready \{[^}]*background: var\(--forest-deep\)/.test(cssSource)) issues.push("ready-state-material");
  if (!/aria-label=(?:"Voice draft sources"|\{copy\.lineage\.ariaLabel\})/.test(panelSource) || !/Voice draft sources/.test(panelSource) || !/Manage sources/.test(panelSource)) issues.push("source-lineage");
  if (!/whole line is planned once so language switches keep one rhythm/i.test(panelSource) ||
      /Each segment is planned before synthesis/.test(panelSource)) issues.push("continuous-code-switch-guidance");
  if (!/Array\.isArray\(draft\.source_ids\)/.test(panelSource) || !/Array\.isArray\(draft\.references\)/.test(panelSource)) issues.push("rolling-lineage-shape");
  if (/best|winner|indistinguishable|state.of.the.art/i.test(panelSource)) issues.push("unmeasured-quality-claim");
  return issues;
}

const live = findings(panel, api, app, css);
check("Meet voice UI contract is complete", live.length === 0, live.join(", "));
check("phone logo and Meet tabs keep a 44px touch target",
  /\.studio-logo\s*\{[^}]*min-height:\s*44px;[^}]*min-width:\s*44px;/s.test(mobileCss) &&
  /\.mirror-tabs button\s*\{[^}]*min-height:\s*44px;[^}]*min-width:\s*44px;/s.test(mobileCss));
check("NEGATIVE CONTROL: the former 35px Meet tabs are caught",
  !/\.mirror-tabs button\s*\{[^}]*min-height:\s*44px;[^}]*min-width:\s*44px;/s.test(
    mobileCss.replace(".mirror-tabs button {\n      min-height: 44px;", ".mirror-tabs button {\n      min-height: 35px;")));

const negativeControls = [
  ["language control loss", panel.replace('type PreviewLanguage = "hi" | "hi-latn" | "en"', 'type PreviewLanguage = "hi" | "en"'), api, app, css, "three-language-ui"],
  ["wrong API language mapping", panel.replace('language === "en" ? "en" : "hi"', "language"), api, app, css, "api-language-binding"],
  ["pointer-only generation", panel.replace(/onClick=\{\(\) => \{ if \(!reason\) startPreview\([^\n]+/, 'onPointerDown={() => { if (!reason) startPreview(false); }}'), api, app, css, "semantic-generate-action"],
  ["fake progress returns", panel.replace('<div className="hear-voice-wait-metrics"', '<progress value="50" max="100" /><div className="hear-voice-wait-metrics"'), api, app, css, "fake-progress"],
  ["return time disappears", panel.replace("Return around", "Wait"), api, app, css, "return-guidance"],
  ["correction action disappears", panel.replace("Not right yet?", "Result"), api, app, css, "correction-loop"],
  ["per-tab storage returns", panel.replaceAll("localStorage", "sessionStorage"), api, app, css, "durable-intent-resume"],
  ["another tab overwrites an edit", panel.replace("if (restoredRef.current && composerDirty && activeIntentRef.current !== signature)", "if (false)"), api, app, css, "cross-tab-draft-preserved"],
  ["regenerate key disappears", panel.replace("crypto.randomUUID()", "undefined"), api, app, css, "correction-loop"],
  ["terminal response becomes generic", panel, api.replaceAll('kind: "failed"', 'kind: "ready"'), app, css, "terminal-intent-recovery"],
  ["closed page overclaims background work", panel.replace("Closing this page pauses browser checks.", "Work continues after you close this page."), api, app, css, "background-work-overclaim"],
  ["active composer unlocks", panel.replaceAll("disabled={busy}", "disabled={false}"), api, app, css, "immutable-active-composer"],
  ["countdown becomes a live region", panel.replace('className={`hear-voice-stage hear-voice-stage-${phase.kind}`} aria-busy={busy}', 'className={`hear-voice-stage hear-voice-stage-${phase.kind}`} aria-live="polite" aria-busy={busy}'), api, app, css, "quiet-live-status"],
  ["preview intent receipt disappears", panel, api.replace('response.headers.get("x-vyakti-preview-intent")', '""'), app, css, "durable-api-contract"],
  ["session expiry forgets the request", panel.replaceAll("onAuthError(cause);", "clearPersistedIntent(replicaId);"), api, app, css, "session-expiry-resume"],
  ["poll reads mutable text", panel.replace("text: intent.text", "text"), api, app, css, "immutable-request-replay"],
  ["receipt disclosure weakens", panel, api.replace('disclosure !== "audible-prefix-v1"', "false"), app, css, "protected-receipt-required"],
  ["self-test readiness returns", panel, api, app.replace("!testEnvironment && <ReadinessStrip", "true && <ReadinessStrip"), css, "self-test-compliance-removed"],
  ["mobile correction rule disappears", panel, api, app, css.replace(".hear-voice-wait-metrics, .hear-voice-correction { grid-template-columns: 1fr; }", ".hear-voice-wait-metrics { grid-template-columns: 1fr; }"), "mobile-correction-layout"],
  ["source lineage disappears", panel.replace('ariaLabel: "Voice draft sources"', 'ariaLabel: "Voice draft"'), api, app, css, "source-lineage"],
  ["stitched-segment guidance returns", panel.replace("The whole line is planned once so language switches keep one rhythm.", "Each segment is planned before synthesis."), api, app, css, "continuous-code-switch-guidance"],
];

for (const [label, panelSource, apiSource, appSource, cssSource, expected] of negativeControls) {
  check(`NEGATIVE CONTROL: ${label} is caught`, findings(panelSource, apiSource, appSource, cssSource).includes(expected));
}

if (!process.exitCode) console.log(`\nvoice-preview-ui: ${passed} checks passed`);
