import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const landing = readFileSync(resolve(root, "site/vyakti.html"), "utf8");
const panel = readFileSync(resolve(root, "src/studio/VideoEnrollPanel.tsx"), "utf8");
const css = readFileSync(resolve(root, "src/studio/video-enroll.css"), "utf8");

let checks = 0;
let failures = 0;

function ok(label, pass) {
  checks += 1;
  if (pass) console.log(`  ok  ${label}`);
  else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}

function visibleHtml(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

const visibleLanding = visibleHtml(landing);

console.log("\nGeneric public entry");
ok("landing is personal-clone first", /Make an AI version of you\./.test(visibleLanding));
ok("landing sends one primary action to the generic studio", /href="\/studio"[^>]*>Start with my voice<\/a>/.test(landing));
ok("landing has no vertical-specific framing", !/\b(?:teacher|student|lecture|classroom|pedagogy|sheet draft)\b/i.test(visibleLanding));
ok("landing states the self-owned material boundary", /your own voice and material you control/i.test(visibleLanding));
ok("landing separates identity and model permission", /Identity and model permission are checked separately\./.test(visibleLanding));
ok("landing does not promise likeness or a model winner", !/exact clone|indistinguishable|best voice|perfect voice|sounds exactly/i.test(visibleLanding));
ok("landing includes skip navigation and labeled main navigation", /class="skip-link" href="#main"/.test(landing) && /aria-label="Main navigation"/.test(landing));
ok("landing keeps browser zoom available", /width=device-width, initial-scale=1\.0/.test(landing) && !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i.test(landing));
ok("landing honors reduced motion", /@media \(prefers-reduced-motion: reduce\)/.test(landing));
ok("landing gives primary controls at least 48px", /\.nav-link,[\s\S]*?\.button\s*\{[\s\S]*?min-height:\s*48px/.test(landing));
ok("landing has explicit narrow-phone and landscape layouts", /@media \(max-width: 620px\)/.test(landing) && /orientation: landscape/.test(landing));
ok("landing uses SVG, not emoji, for interface symbols", /<svg\b/.test(landing) && !/[\u{1F300}-\u{1FAFF}]/u.test(visibleLanding));

console.log("\nGeneric YouTube entry");
ok("panel copy is generic", !/\b(?:teacher|student|lecture|classroom|pedagogy|sheet draft)\b/i.test(panel));
ok("every account checks video metadata before import", /inspectYouTubeVideo\(token, videoUrl\.trim\(\)\)/.test(panel) && !/video-enroll-channel/.test(panel));
ok("metadata supplies the verified channel binding", /setChannelUrl\(found\.channel_url\)/.test(panel));
ok("public import still requires all five source statements", /VIDEO_ATTESTATIONS\.every\(\(key\) => ticked\[key\] === true\)/.test(panel));
ok("source agreement appears only after a verified video", /!testEnvironment && metadata && view\?\.extraction_configured/.test(panel));
ok("unconfigured extraction exposes file upload without a test-mode gate", /extractionUnavailable && \([\s\S]*?onUseFileUpload && \([\s\S]*?Upload the file instead/.test(panel));
ok("import errors also keep file recovery visible", /role="alert"[\s\S]*?onUseFileUpload && \([\s\S]*?Upload a video file/.test(panel));
ok("unavailable import is an honest named state", /Link import is not connected yet/.test(panel) && /This path is available now\./.test(panel));
ok("video link uses a visible label and helper association", /htmlFor="video-enroll-url"/.test(panel) && /aria-describedby="video-enroll-link-help video-enroll-limit"/.test(panel));
ok("async and error states are announced", /role="status"/.test(panel) && /role="alert"/.test(panel) && /aria-busy=/.test(panel));
ok("panel keeps the quality-score boundary", /recording quality, not how similar the clone sounds/.test(panel));
ok("video CSS has touch-size controls and mobile reflow", /min-height:\s*48px/.test(css) && /@media \(max-width: 680px\)/.test(css));
ok("video CSS preserves focus and reduced-motion behavior", /:focus-visible/.test(css) && /@media \(prefers-reduced-motion: reduce\)/.test(css));

if (failures) {
  console.error(`\n${failures} of ${checks} generic-entry checks failed`);
  process.exit(1);
}

console.log(`\n${checks} generic-entry checks passed`);
