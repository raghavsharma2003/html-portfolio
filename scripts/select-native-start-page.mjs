#!/usr/bin/env node
// WS-R157. Capacitor's local server always serves `<webDir>/index.html` at
// "/" — checked against the installed CLI's own `declarations.d.ts`:
// `server.url` is a REMOTE override for live-reload only ("not intended for
// use in production"), and there is no field that picks a different LOCAL
// entry file out of `webDir`. Meera's own web build never needed a script
// for this: `index.html` at the repo root already IS her chat app's real
// vite entry (`vite.config.ts`'s `index: "index.html"`), so a plain
// `npx vite build` already puts the right page at `dist/index.html`.
//
// The Vyakti flavour's start page is `/studio` — a SECOND vite entry
// (`studio: "studio.html"`), never the first — so after the SAME build this
// script does the one thing Meera's flavour never has to: copy the
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
