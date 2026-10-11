#!/usr/bin/env node
// WS-R157. Capacitor's local server always serves `<webDir>/index.html` at
// "/" — checked against the installed CLI's own `declarations.d.ts`:
// `server.url` is a REMOTE override for live-reload only ("not intended for
// use in production"), and there is no field that picks a different LOCAL
// entry file out of `webDir`.
//
// Vyakti's start page is `/studio`, a Vite entry emitted as `studio.html`.
// After the web build this script copies the
// ALREADY-BUILT `dist/studio.html` over `dist/index.html`, byte for byte.
// It never re-runs vite and never rewrites a hashed asset path, because
// `studio.html`'s own `<script>`/`<link>` tags are already absolute
// (`/assets/...`) and the assets they name are already sitting in the same
// `dist/` — the identical bytes `/studio` already serves on the web are
// what the WebView loads at "/".
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function selectNativeStartPage(page, { distDir = join(process.cwd(), "dist") } = {}) {
  const source = join(distDir, `${page}.html`);
  if (!existsSync(source)) throw new Error(`select-native-start-page: ${source} does not exist — run the web build first`);
  const bytes = readFileSync(source, "utf8");
  writeFileSync(join(distDir, "index.html"), bytes);
  return bytes;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const page = process.argv[2];
  if (!page) {
    console.error("select-native-start-page: usage: node scripts/select-native-start-page.mjs <page-without-.html>");
    process.exit(1);
  }
  try {
    selectNativeStartPage(page);
    console.log(`select-native-start-page: dist/index.html <- dist/${page}.html`);
  } catch (error) {
    console.error(`select-native-start-page: ${error.message}`);
    process.exit(1);
  }
}
