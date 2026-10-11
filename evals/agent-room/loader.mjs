import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = pathToFileURL(join(HERE, "db.mjs")).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && specifier.split("/").pop() === "_db.js") {
    return { url: DB, shortCircuit: true, format: "module" };
  }
  return nextResolve(specifier, context);
}
