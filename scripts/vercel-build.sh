#!/usr/bin/env bash
# Vercel build for the Meera website. MCP deploys carry a thin text payload
# (package.json, vercel.json, api/, this script) — the full source tree,
# including her photos, is pulled from the GitHub branch at build time.
# Local runs (src/ already present) skip the fetch entirely.
set -euo pipefail

BRANCH="claude/ai-companion-app-rkt1lv"
TARBALL="https://codeload.github.com/raghavsharma2003/html-portfolio/tar.gz/refs/heads/$BRANCH"

if [ ! -d src ]; then
  curl -fsSL "$TARBALL" -o /tmp/meera-src.tgz
  mkdir -p /tmp/meera-src
  tar -xzf /tmp/meera-src.tgz -C /tmp/meera-src --strip-components=1
  # -n: payload files (notably api/_config.js with the key) always win
  cp -Rn /tmp/meera-src/. .
fi

npx vite build

# / is the landing page, /chat is the app (see vercel.json rewrite)
mv dist/index.html dist/chat.html
cp site/index.html dist/index.html
cp site/styles.css dist/styles.css
cp site/privacy.html dist/privacy.html
mkdir -p dist/assets
cp -R site/assets/. dist/assets/
