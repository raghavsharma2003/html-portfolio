// Wave 25: one native product, with Android and iOS carrying Vyakti's identity.
// Static/read-only and deterministic; no Gradle, network, browser or provider.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
let pass = 0;
let fail = 0;
const ok = (name, condition) => {
  condition ? pass++ : fail++;
  console.log(`${condition ? "  ok  " : "FAIL  "}${name}`);
};

for (const path of ["capacitor.config.ts", "capacitor.vyakti.config.ts"]) {
  const source = read(path);
  ok(`${path}: appId`, /appId:\s*"app\.vyakti\.studio"/.test(source));
  ok(`${path}: app name`, /appName:\s*"Vyakti"/.test(source));
  ok(`${path}: studio webDir`, /webDir:\s*"dist"/.test(source));
  ok(`${path}: Vyakti OTA origin`, /https:\/\/vyakti-replica-lab\.vercel\.app\/ota\/latest\.json/.test(source));
}

const gradle = read("android/app/build.gradle");
ok("Android namespace is app.vyakti.studio", /namespace\s*=\s*"app\.vyakti\.studio"/.test(gradle));
ok("Android applicationId is app.vyakti.studio", /applicationId\s+"app\.vyakti\.studio"/.test(gradle));
ok("Android has no product flavour split", !/flavorDimensions|productFlavors|\bmeera\s*\{/.test(gradle));
ok("Android uses Vyakti signing inputs", /VYAKTI_ANDROID_KEYSTORE_PASSWORD/.test(gradle) && /VYAKTI_ANDROID_KEY_ALIAS/.test(gradle) && /VYAKTI_ANDROID_KEY_PASSWORD/.test(gradle));
ok("Android APK version advances for the sole-product shell", /versionCode\s+27\b/.test(gradle) && /versionName\s+"27\.0"/.test(gradle));
ok("OTA native contract advances for the renamed plugin", /buildConfigField\s+"int",\s*"OTA_NATIVE_CONTRACT",\s*"2"/.test(gradle));
ok("deep-link host comes from Vyakti origin", /VYAKTI_PUBLIC_APP_ORIGIN/.test(gradle) && /manifestPlaceholders\s*=\s*\[vyaktiAppHost:/.test(gradle));

const manifest = read("android/app/src/main/AndroidManifest.xml");
ok("Android manifest has one activity", (manifest.match(/<activity\b/g) || []).length === 1);
for (const permission of ["RECORD_AUDIO", "CAMERA", "POST_NOTIFICATIONS"]) {
  ok(`Android manifest declares ${permission}`, manifest.includes(`android.permission.${permission}`));
}
ok("Android manifest carries verified Room links", /android:autoVerify="true"/.test(manifest) && /android:pathPrefix="\/r\/"/.test(manifest));
ok("Android manifest carries verified card links", /android:pathPrefix="\/c\/"/.test(manifest));
ok("old flavour manifest is absent", !existsSync(join(ROOT, "android/app/src/vyakti/AndroidManifest.xml")));

const strings = read("android/app/src/main/res/values/strings.xml");
ok("Android visible name is Vyakti", /<string name="app_name">Vyakti<\/string>/.test(strings));
ok("Android package resource is Vyakti", /<string name="package_name">app\.vyakti\.studio<\/string>/.test(strings));
for (const density of ["ldpi", "mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
  ok(`Android ${density} launcher icons exist`, ["ic_launcher.png", "ic_launcher_round.png"].every((name) => existsSync(join(ROOT, `android/app/src/main/res/mipmap-${density}/${name}`))));
}

const javaRoot = join(ROOT, "android/app/src/main/java/app/vyakti/studio");
const javaFiles = readdirSync(javaRoot).filter((name) => name.endsWith(".java"));
ok("native Java package contains the required shell and OTA classes", ["MainActivity.java", "MicPermissionFastPath.java", "OtaBundle.java", "OtaPlugin.java", "OtaState.java", "OtaUpdater.java"].every((name) => javaFiles.includes(name)));
ok("all Java sources use the Vyakti package", javaFiles.every((name) => readFileSync(join(javaRoot, name), "utf8").startsWith("package app.vyakti.studio;")));
const nativeText = javaFiles.map((name) => readFileSync(join(javaRoot, name), "utf8")).join("\n");
ok("native OTA plugin and origin are Vyakti", /VyaktiUpdater/.test(nativeText) && /https:\/\/vyakti-replica-lab\.vercel\.app\/ota\/latest\.json/.test(nativeText));

const iosProject = read("ios/App/App.xcodeproj/project.pbxproj");
const iosInfo = read("ios/App/App/Info.plist");
ok("iOS bundle id is app.vyakti.studio in every build configuration", (iosProject.match(/PRODUCT_BUNDLE_IDENTIFIER = app\.vyakti\.studio;/g) || []).length >= 2);
ok("iOS visible name is Vyakti", /<key>CFBundleDisplayName<\/key>\s*<string>Vyakti<\/string>/.test(iosInfo));

const shipping = [gradle, manifest, strings, nativeText, iosProject, iosInfo, read("capacitor.config.ts")].join("\n");
ok("shipping native identity has no separate product reference", !/app\.meera\.companion|meera-silk\.vercel\.app|\bMeera\b|\bMaya\b/.test(shipping));

// The deep-link association document is a real public Vyakti door. Test its
// pure builder and the HTTP wrapper, including malformed-input controls.
const { buildAssetLinksDocument, VYAKTI_PACKAGE_NAME } = await import(pathToFileURL(join(ROOT, "api/_well-known-assetlinks.js")).href);
ok("assetlinks package name is app.vyakti.studio", VYAKTI_PACKAGE_NAME === "app.vyakti.studio");
ok("assetlinks env unset is honestly empty", JSON.stringify(buildAssetLinksDocument({})) === "[]");
ok("assetlinks empty env is honestly empty", JSON.stringify(buildAssetLinksDocument({ VYAKTI_ANDROID_CERT_FINGERPRINT_SHA256: "" })) === "[]");

const validFingerprint = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, "0").toUpperCase()).join(":");
const assetlinks = buildAssetLinksDocument({ VYAKTI_ANDROID_CERT_FINGERPRINT_SHA256: validFingerprint });
ok("valid fingerprint produces one Android association", assetlinks.length === 1 && assetlinks[0]?.relation?.[0] === "delegate_permission/common.handle_all_urls");
ok("association carries the Vyakti package and fingerprint", assetlinks[0]?.target?.package_name === "app.vyakti.studio" && assetlinks[0]?.target?.sha256_cert_fingerprints?.[0] === validFingerprint);
const lowercase = buildAssetLinksDocument({ VYAKTI_ANDROID_CERT_FINGERPRINT_SHA256: validFingerprint.toLowerCase() });
ok("lowercase fingerprint is normalised", lowercase[0]?.target?.sha256_cert_fingerprints?.[0] === validFingerprint);

for (const [label, fingerprint] of Object.entries({
  "not hex": "not-a-fingerprint",
  "no colons": validFingerprint.replace(/:/g, ""),
  "one digit short": validFingerprint.slice(0, -1),
  "one octet long": `${validFingerprint}:FF`,
  "non-hex octet": `GG:${validFingerprint.slice(3)}`,
})) {
  ok(`NEGATIVE CONTROL: malformed fingerprint rejected (${label})`, JSON.stringify(buildAssetLinksDocument({ VYAKTI_ANDROID_CERT_FINGERPRINT_SHA256: fingerprint })) === "[]");
}

const { default: assetLinksHandler } = await import(pathToFileURL(join(ROOT, "api/well-known-assetlinks.js")).href);
const fakeResponse = () => {
  const calls = { statusCodes: [], sentBodies: [], headers: {} };
  const response = {
    calls,
    status(code) { calls.statusCodes.push(code); return response; },
    send(body) { calls.sentBodies.push(body); return response; },
    setHeader(name, value) { calls.headers[name] = value; return response; },
  };
  return response;
};
const priorFingerprint = process.env.VYAKTI_ANDROID_CERT_FINGERPRINT_SHA256;
try {
  delete process.env.VYAKTI_ANDROID_CERT_FINGERPRINT_SHA256;
  const unsetResponse = fakeResponse();
  await assetLinksHandler({ method: "GET" }, unsetResponse);
  ok("assetlinks GET without fingerprint returns an empty JSON document", unsetResponse.calls.statusCodes[0] === 200 && unsetResponse.calls.sentBodies[0] === "[]" && /application\/json/.test(unsetResponse.calls.headers["Content-Type"] || ""));

  process.env.VYAKTI_ANDROID_CERT_FINGERPRINT_SHA256 = validFingerprint;
  const configuredResponse = fakeResponse();
  await assetLinksHandler({ method: "GET" }, configuredResponse);
  const configuredBody = JSON.parse(configuredResponse.calls.sentBodies[0]);
  ok("assetlinks GET returns the configured association", configuredResponse.calls.statusCodes[0] === 200 && configuredBody[0]?.target?.sha256_cert_fingerprints?.[0] === validFingerprint);

  const postResponse = fakeResponse();
  await assetLinksHandler({ method: "POST" }, postResponse);
  ok("NEGATIVE CONTROL: assetlinks rejects POST", postResponse.calls.statusCodes[0] === 405);
} finally {
  if (priorFingerprint === undefined) delete process.env.VYAKTI_ANDROID_CERT_FINGERPRINT_SHA256;
  else process.env.VYAKTI_ANDROID_CERT_FINGERPRINT_SHA256 = priorFingerprint;
}

const vercel = JSON.parse(read("vercel.json"));
const assetlinksRewrite = (vercel.rewrites || []).find((entry) => entry.source === "/.well-known/assetlinks.json");
ok("Vercel routes the assetlinks document to its public handler", assetlinksRewrite?.destination === "/api/well-known-assetlinks");
ok("Vercel assigns headers to the assetlinks document", (vercel.headers || []).some((entry) => entry.source === "/.well-known/assetlinks.json"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
