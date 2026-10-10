import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const service = join(here, "..", "..", "services", "azure-verifier");
const tests = readdirSync(join(service, "test"))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => join("test", name));

execFileSync(process.execPath, ["--test", ...tests], {
  cwd: service,
  stdio: "inherit",
});

console.log("azure verifier: offline signed-boundary gate passed");
