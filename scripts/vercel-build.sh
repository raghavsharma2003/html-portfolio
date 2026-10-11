#!/usr/bin/env bash
# Vercel build for Vyakti. API-driven deploys may carry a thin text payload
# (package.json, vercel.json, api/, this script), so the complete source tree
# is pulled from the GitHub branch when src/ is absent.
# Local runs (src/ already present) skip the fetch entirely.
set -euo pipefail

# Prefer the ref Vercel is actually building. Thin API-driven production
# deploys carry no git ref and materialise the production branch.
BRANCH="${VERCEL_GIT_COMMIT_REF:-main}"
TARBALL="https://codeload.github.com/raghavsharma2003/html-portfolio/tar.gz/refs/heads/$BRANCH"

if [ ! -d src ]; then
  curl -fsSL "$TARBALL" -o /tmp/vyakti-src.tgz
  mkdir -p /tmp/vyakti-src
  tar -xzf /tmp/vyakti-src.tgz -C /tmp/vyakti-src --strip-components=1
  # -n: explicit payload files (notably this build contract) always win. Local
  # api/_config.js is excluded before upload and must never arrive here.
  cp -Rn /tmp/vyakti-src/. .
fi

DEPLOY_PRODUCT="$(node scripts/vercel-product.mjs)"
RELEASE_MARKER=".vercel-release-preinstall.json"
if [ ! -f "$RELEASE_MARKER" ]; then
  # Local/manual build fallback. Vercel's install phase always writes this
  # before npm ci, which is the release boundary used in production.
  node scripts/deploy-commitment.mjs \
    --product "$DEPLOY_PRODUCT" \
    --write "$RELEASE_MARKER"
fi

# api/_config.js is gitignored, so builds driven by Vercel's own GitHub
# integration (html-portfolio previews, vyakti-replica-lab) arrive without it
# and every API route 500s — including studio sign-in. Reconstruct it here
# from the Vercel project's env vars (same generator CI uses). If the project
# has no env vars yet, fall back to the stub LOUDLY: the static site still
# deploys and renders, the APIs stay honestly dead until the values are set
# (which ones: docs/gurukul/ENV-MANIFEST.md).
# Vyakti has one serving provider. Validate its Azure and database contract on
# every deploy, even if a stale generated config file is already present.
CI=1 node scripts/write-config.mjs --vyakti-deploy

npx vite build

# The native app opens the Studio. Select that already-built entry as the
# bundle root before packing; the public web root becomes the landing below.
node scripts/select-native-start-page.mjs studio
node scripts/ota-bundle.mjs

# `/` is always Vyakti's landing and `/studio` is always the Studio. The old
# project and branch selector is retired.
cp site/vyakti.html dist/index.html
cp site/vyakti-privacy.html dist/privacy.html
cp site/vyakti-delete-account.html dist/delete-account.html
cp site/suites.html dist/suites.html
cp site/styles.css dist/styles.css
mkdir -p dist/assets
cp -R site/assets/. dist/assets/

# WS-R45: the creator directory and robots.txt. robots.txt needs no
# vercel.json rewrite: a file already named
# robots.txt at dist's root serves at /robots.txt with no rewrite required,
# the same reason privacy.html DOES need one and this does not.
cp site/creators.html dist/creators.html
cp site/robots.txt dist/robots.txt
# A stable source commitment, separate from environment-sensitive Vite chunk
# names. scripts/verify-deploy.mjs compares this exact release identity after
# deployment, so a stale alias or wrong project still fails without treating a
# different build-time environment as stale source.
cp "$RELEASE_MARKER" dist/vyakti-release.json
