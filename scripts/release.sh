#!/usr/bin/env bash
#
# Custom publish step for changesets/action.
#
# Invoked by `.github/workflows/release.yml` once the "Version Packages" PR
# has been merged and no pending changesets remain. We don't publish to
# npm — `playground-cli` is private — so this script owns the build, the
# release tag, and the GitHub Release end-to-end.
#
# Idempotent: every push to main with no pending changesets re-runs this
# script, but only the run immediately following a Version Packages merge
# actually has a new version to ship. The early-return on existing tags
# turns every other invocation into a fast no-op.

set -euo pipefail

VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
    echo "Tag ${TAG} already exists — nothing to release."
    exit 0
fi

echo "Building SEA binaries for ${TAG}..."
bun build --compile --target=bun-linux-x64    src/index.ts --outfile dot-linux-x64
bun build --compile --target=bun-linux-arm64  src/index.ts --outfile dot-linux-arm64
bun build --compile --target=bun-darwin-x64   src/index.ts --outfile dot-darwin-x64
bun build --compile --target=bun-darwin-arm64 src/index.ts --outfile dot-darwin-arm64

echo "Tagging ${TAG}..."
git tag "${TAG}"
git push origin "${TAG}"

echo "Creating GitHub Release ${TAG}..."
gh release create "${TAG}" \
    dot-linux-x64 dot-linux-arm64 dot-darwin-x64 dot-darwin-arm64 \
    --title "Release ${TAG}" \
    --generate-notes
