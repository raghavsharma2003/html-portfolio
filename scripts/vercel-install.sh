#!/usr/bin/env bash
# Capture the immutable uploaded source before the package manager or build
# tools can touch it, then install exactly what package-lock.json describes.
set -euo pipefail

BRANCH="${VERCEL_GIT_COMMIT_REF:-claude/gurukul-platform}"
TARBALL="https://codeload.github.com/raghavsharma2003/html-portfolio/tar.gz/refs/heads/$BRANCH"

# Thin API-driven deployments carry the build contract but not the complete
# repository. Materialise that source before hashing it. Full and Git-connected
# deployments already have src/ and skip this branch.
if [ ! -d src ]; then
  curl -fsSL "$TARBALL" -o /tmp/meera-src.tgz
  mkdir -p /tmp/meera-src
  tar -xzf /tmp/meera-src.tgz -C /tmp/meera-src --strip-components=1
  cp -Rn /tmp/meera-src/. .
fi

node scripts/write-deploy-marker.mjs

# npm ci refuses a package.json/package-lock mismatch and never reconciles or
# rewrites the lockfile. The marker above remains the uploaded-source identity
# even if a future package manager or build tool mutates its working tree.
npm ci --no-audit --no-fund
