#!/usr/bin/env bash
# Vercel build for the Meera website. MCP deploys carry a thin text payload
# (package.json, vercel.json, api/, this script) — the full source tree,
# including her photos, is pulled from the GitHub branch at build time.
# Local runs (src/ already present) skip the fetch entirely.
set -euo pipefail

# Prefer the branch Vercel is actually building (set on every git-connected
# deploy); fall back to gurukul-platform for thin MCP deploys, which carry no
# git ref. Git-connected builds have src/ present and skip the fetch entirely,
# so this only decides which branch a thin deploy pulls source from.
BRANCH="${VERCEL_GIT_COMMIT_REF:-claude/gurukul-platform}"
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

# / is the landing page, /chat is the app (see vercel.json rewrite).
# On the studio project (vyakti-replica-lab sets STUDIO_ROOT=1), / redirects
# to the teacher studio instead of serving the companion landing — one build,
# two products, the difference is a per-project env var, never a branch.
mv dist/index.html dist/chat.html
# Studio-root when explicitly flagged OR when this is a platform-branch build
# (claude/gurukul-platform, or any claude/vyakti-cloning-platform-* ref: the
# vyakti product's branch family, matched as a pattern so a rename inside the
# family needs no script change) — so the replica project shows the studio at /
# with no per-project env var, while the companion branch keeps Meera's landing.
case "${VERCEL_GIT_COMMIT_REF:-}" in claude/gurukul-platform|claude/vyakti-cloning-platform-*) PLATFORM_BRANCH=1 ;; *) PLATFORM_BRANCH=0 ;; esac
if [ "${STUDIO_ROOT:-}" = "1" ] || [ "$PLATFORM_BRANCH" = "1" ]; then
  # Vyakti's own landing, not a redirect. `/` used to be a one-line meta
  # refresh into /studio?mode=teacher, which meant the product had no
  # indexable page at all, no way to explain itself before asking a teacher
  # for a government ID, and a browser tab that said "Replica Studio" to a
  # stranger. site/vyakti.html is self-contained (its CSS is inline) so it
  # needs no second cp line and no coupling to Meera's site/styles.css, which
  # scripts/check-contrast.mjs reads by name. See docs/gurukul/DESIGN-SYSTEM.md.
  cp site/vyakti.html dist/index.html
  cp site/vyakti-privacy.html dist/privacy.html
  cp site/vyakti-delete-account.html dist/delete-account.html
else
  cp site/index.html dist/index.html
  cp site/privacy.html dist/privacy.html
  cp site/delete-account.html dist/delete-account.html
fi
cp site/styles.css dist/styles.css
mkdir -p dist/assets
cp -R site/assets/. dist/assets/

# WS-R45: the creator directory and robots.txt. Copied unconditionally
# (neither branches on STUDIO_ROOT/PLATFORM_BRANCH the way vyakti.html does
# above) — Meera's build has no /creators route and no crawler policy of its
# own to collide with, and shipping these two static files on every build is
# simpler than a second copy of the branch check above for one page and one
# text file. robots.txt needs no vercel.json rewrite: a file already named
# robots.txt at dist's root serves at /robots.txt with no rewrite required,
# the same reason privacy.html DOES need one and this does not.
cp site/creators.html dist/creators.html
cp site/robots.txt dist/robots.txt
