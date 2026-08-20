// Bundle the REAL trace + telemetry modules so the suite drives production
// code. Same discipline (and the same capacitor stub) as evals/run.mjs: rebuilt
// on every run, never cached — parsetest.v2 taught this repo that a frozen
// bundle passes forever while the source rots.
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
export const BUNDLE = join(HERE, ".bundle.mjs");

export function build() {
  execSync(
    `npx esbuild ${join(HERE, ".entry.ts")} --bundle --format=esm --platform=node ` +
      `--outfile=${BUNDLE} --log-level=error ` +
      `--alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
    { stdio: "inherit", cwd: ROOT },
  );
  return BUNDLE;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  build();
  console.log("built", BUNDLE);
}
