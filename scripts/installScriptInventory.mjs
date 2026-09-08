import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { INSTALL_SCRIPT_ALLOWLIST } from "./installScriptAllowlist.mjs";

const lifecycle = ["preinstall", "install", "postinstall"];
const within = (parent, child) => {
  const path = relative(parent, child);
  return path !== "" && !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
};
const hooks = scripts => Object.fromEntries(lifecycle.filter(name => scripts?.[name] !== undefined).map(name => [name, scripts[name]]));
const sameHooks = (left, right) => JSON.stringify(hooks(left)) === JSON.stringify(hooks(right));

/** Read-only inventory. Never imports, executes or resolves the package entry. */
export async function verifyInstalledHook(pkg, { root, allowlist = INSTALL_SCRIPT_ALLOWLIST }) {
  const reject = (code, detail) => ({ ok: false, code, detail });
  const entry = allowlist.find(item => item.name === pkg.name && item.version === pkg.version);
  if (!entry) return reject("unallowlisted-install-script", "Exact package name and version require review");
  if (!entry.reason?.trim() || !entry.scripts || !entry.files || !Object.keys(entry.files).length) return reject("incomplete-install-review", "Review must pin commands, file hashes and a reason");
  if (!sameHooks(pkg.scripts, entry.scripts)) return reject("install-command-changed", "Declared lifecycle commands differ from the reviewed commands");
  try {
    const modules = await realpath(resolve(root, "node_modules"));
    const location = pkg.path || (pkg.location ? resolve(root, pkg.location) : null);
    if (typeof location !== "string") return reject("install-location-missing", "npm inventory did not identify the installed package location");
    const packageDir = await realpath(resolve(root, location));
    if (!within(modules, packageDir)) return reject("install-location-outside-tree", "Installed package must resolve within this dependency tree");
    const manifestPath = await realpath(resolve(packageDir, "package.json"));
    if (!within(packageDir, manifestPath)) return reject("install-manifest-outside-package", "Package manifest resolves outside the installed package");
    const installed = JSON.parse(await readFile(manifestPath, "utf8"));
    if (installed.name !== entry.name || installed.version !== entry.version) return reject("install-identity-changed", "Installed manifest differs from the reviewed package identity");
    if (!sameHooks(installed.scripts, entry.scripts)) return reject("install-command-changed", "Installed lifecycle commands differ from the reviewed commands");
    for (const [file, expected] of Object.entries(entry.files)) {
      if (!/^[a-f0-9]{64}$/.test(expected)) return reject("invalid-install-review-hash", "Reviewed file hash must be SHA256");
      const lexical = resolve(packageDir, file);
      if (!within(packageDir, lexical)) return reject("install-file-outside-package", "Reviewed file must stay within the package");
      const actualPath = await realpath(lexical);
      if (!within(packageDir, actualPath)) return reject("install-file-outside-package", "Reviewed file resolves outside the package");
      const actual = createHash("sha256").update(await readFile(actualPath)).digest("hex");
      if (actual !== expected) return reject("install-file-changed", "Installed hook bytes differ from the reviewed SHA256");
    }
    return { ok: true, code: "reviewed-install-script", detail: "Exact identity, lifecycle commands and reviewed hook hashes matched" };
  } catch {
    return reject("install-review-unreadable", "Installed review material could not be read or parsed");
  }
}
