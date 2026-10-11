// SOURCE PREPARED ONLY. Node-only controls; never executes a lifecycle hook.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { verifyInstalledHook } from "../scripts/installScriptInventory.mjs";
import { INSTALL_SCRIPT_ALLOWLIST } from "../scripts/installScriptAllowlist.mjs";

const temp = await mkdtemp(join(tmpdir(), "install-script-inventory-"));
const root = join(temp, "repo");
const path = join(root, "node_modules", "esbuild");
const bytes = "throw new Error('THIS_HOOK_MUST_NEVER_EXECUTE');\n";
const hash = createHash("sha256").update(bytes).digest("hex");
const reviewed = { name: "esbuild", version: "0.28.2", scripts: { postinstall: "node install.js" }, files: { "install.js": hash }, reason: "Synthetic read-only inventory fixture" };
const hit = { name: reviewed.name, version: reviewed.version, scripts: reviewed.scripts, path };
let controls = 0;
async function expect(name, pkg, options, code) {
  const result = await verifyInstalledHook(pkg, { root, allowlist: [reviewed], ...options });
  assert.equal(result.code, code, name); assert.equal(result.ok, code === "reviewed-install-script", name);
  controls++; console.log(`ok ${name}`);
}
const manifest = value => writeFile(join(path, "package.json"), JSON.stringify(value));
try {
  assert.equal(INSTALL_SCRIPT_ALLOWLIST.length, 1);
  assert.equal(INSTALL_SCRIPT_ALLOWLIST[0].name, "esbuild");
  assert.equal(INSTALL_SCRIPT_ALLOWLIST[0].version, "0.28.2");
  assert.deepEqual(INSTALL_SCRIPT_ALLOWLIST[0].scripts, { postinstall: "node install.js" });
  assert.equal(INSTALL_SCRIPT_ALLOWLIST[0].files["install.js"], "612294e278914443bdcf81cb17f54afec34dbdd2ebd999a6ee187912320cc315");
  await mkdir(path, { recursive: true }); await manifest(reviewed); await writeFile(join(path, "install.js"), bytes);
  await expect("Reviewed exact bytes accepted without executing their throw", hit, {}, "reviewed-install-script");
  await expect("Unreviewed version rejected", { ...hit, version: "0.28.3" }, {}, "unallowlisted-install-script");
  await expect("Unreviewed name rejected", { ...hit, name: "esbuild-lookalike" }, {}, "unallowlisted-install-script");
  await expect("Changed reported command rejected", { ...hit, scripts: { postinstall: "node other.js" } }, {}, "install-command-changed");
  await expect("Additional preinstall rejected", { ...hit, scripts: { ...hit.scripts, preinstall: "node extra.js" } }, {}, "install-command-changed");
  await expect("Additional install hook rejected", { ...hit, scripts: { ...hit.scripts, install: "node extra.js" } }, {}, "install-command-changed");
  await manifest({ ...reviewed, version: "0.28.3" });
  await expect("Reported identity cannot hide changed installed version", hit, {}, "install-identity-changed");
  await manifest({ ...reviewed, scripts: { postinstall: "node other.js" } });
  await expect("Reported command cannot hide changed installed command", hit, {}, "install-command-changed");
  await manifest(reviewed); await writeFile(join(path, "install.js"), bytes + "// altered\n");
  await expect("Same name and version cannot hide changed hook bytes", hit, {}, "install-file-changed");
  await writeFile(join(path, "install.js"), bytes);
  await expect("Missing reviewed hook rejected", hit, { allowlist: [{ ...reviewed, files: { "missing.js": hash } }] }, "install-review-unreadable");
  await expect("Location outside node_modules rejected", { ...hit, path: root }, {}, "install-location-outside-tree");
  await expect("Missing npm location rejected", { ...hit, path: undefined }, {}, "install-location-missing");
  await expect("npm relative location supported", { ...hit, path: undefined, location: "node_modules/esbuild" }, {}, "reviewed-install-script");
  await expect("Reviewed file cannot traverse out", hit, { allowlist: [{ ...reviewed, files: { "../outside.js": hash } }] }, "install-file-outside-package");
  await expect("Incomplete review is not a name-only bypass", hit, { allowlist: [{ name: hit.name, version: hit.version, reason: "not enough" }] }, "incomplete-install-review");
  await expect("Malformed hash rejected", hit, { allowlist: [{ ...reviewed, files: { "install.js": "not-sha256" } }] }, "invalid-install-review-hash");
  await writeFile(join(path, "package.json"), "{");
  await expect("Unreadable manifest fails closed", hit, {}, "install-review-unreadable");
  console.log(`install-script-inventory: ${controls} controls passed`);
} finally {
  assert.equal(dirname(resolve(temp)), resolve(tmpdir())); assert.ok(temp.split(/[\\/]/).at(-1).startsWith("install-script-inventory-"));
  await rm(temp, { recursive: true, force: true });
}
