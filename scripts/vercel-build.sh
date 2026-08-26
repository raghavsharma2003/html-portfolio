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

# api/_config.js is gitignored, so builds driven by Vercel's own GitHub
# integration (html-portfolio previews, vyakti-replica-lab) arrive without it
# and every API route 500s — including studio sign-in. Reconstruct it here
# from the Vercel project's env vars (same generator CI uses). If the project
# has no env vars yet, fall back to the stub LOUDLY: the static site still
# deploys and renders, the APIs stay honestly dead until the values are set
# (which ones: docs/gurukul/ENV-MANIFEST.md).
if [ ! -f api/_config.js ]; then
  if ! CI=1 node scripts/write-config.mjs; then
    echo "WARNING: env vars not set on this Vercel project — API routes will fail until they are (docs/gurukul/ENV-MANIFEST.md). Building with stub config."
    CI=1 node scripts/write-config.mjs --stub
  fi
fi

npx vite build

# The Android OTA bundle, zipped from dist BEFORE the shuffle below: the phone
# loads "/" from the bundle root, so the app's own index.html has to still be
# index.html when it is packed. See docs/AUTOUPDATE.md.
node scripts/ota-bundle.mjs

# / is the landing page, /chat is the app (see vercel.json rewrite)
mv dist/index.html dist/chat.html
cp site/index.html dist/index.html
cp site/styles.css dist/styles.css
cp site/privacy.html dist/privacy.html
cp site/delete-account.html dist/delete-account.html
mkdir -p dist/assets
cp -R site/assets/. dist/assets/
