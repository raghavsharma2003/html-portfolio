// Wave 25: one native product, with Android and iOS carrying Vyakti's identity.
// Static/read-only and deterministic; no Gradle, network, browser or provider.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
ok("OTA native contract remains script-readable", /buildConfigField\s+"int",\s*"OTA_NATIVE_CONTRACT",\s*"\d+"/.test(gradle));
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
ok("negative control: shipping native identity has no Meera product reference", !/app\.meera\.companion|meera-silk\.vercel\.app|\bMeera\b|\bMaya\b/.test(shipping));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
