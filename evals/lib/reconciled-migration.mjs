// Source inspection only. This helper never executes or promotes archived SQL.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, relative, isAbsolute } from "node:path";

const DEFAULT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export function readReconciledMigration(originalPath, { root = DEFAULT_ROOT } = {}) {
  if (!/^db\/migrations\/\d{3}_[a-z0-9_]+\.sql$/.test(originalPath)) {
    throw new Error("Invalid original migration path");
  }
  const archive = resolve(root, "db/migrations/reconciliation/local-voice-20260906");
  const manifest = JSON.parse(readFileSync(resolve(archive, "manifest.json"), "utf8"));
  const matches = manifest.entries.filter((entry) => entry.originalPath === originalPath);
  if (matches.length !== 1) throw new Error("Migration identity is missing or ambiguous: " + originalPath);
  const entry = matches[0];
  if (!/^[a-f0-9]{64}$/.test(entry.sha256) || !/^[a-f0-9]{16}-\d{3}_[a-z0-9_]+\.sql$/.test(entry.artifact)) {
    throw new Error("Invalid archived migration identity");
  }
  if (!entry.artifact.startsWith(entry.sha256.slice(0, 16) + "-")) throw new Error("Artifact hash prefix mismatch");
  const path = resolve(archive, entry.artifact);
  const suffix = relative(archive, path);
  if (suffix.startsWith("..") || isAbsolute(suffix)) throw new Error("Migration artifact escapes archive");
  const bytes = readFileSync(path);
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
    throw new Error("Archived migration integrity mismatch: " + originalPath);
  }
  return bytes.toString("utf8");
}
