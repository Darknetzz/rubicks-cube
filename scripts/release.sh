#!/usr/bin/env bash
# Release vX.Y.Z: bump package.json, commit, tag, push to GitLab and GitHub, create the GitHub release.
# GitLab CI then creates the GitLab release and pushes the Docker images (see .gitlab-ci.yml).
#
# Before running: write a "## [vX.Y.Z] - YYYY-MM-DD" section at the top of CHANGELOG.md (uncommitted is fine).
# Usage: scripts/release.sh X.Y.Z [--dry-run]
set -euo pipefail

GITHUB_REPO=Darknetzz/rubiks-cube
GITHUB_URL=git@github.com:$GITHUB_REPO.git

die() { echo "release: $*" >&2; exit 1; }

VERSION="${1:-}"; VERSION="${VERSION#v}"
DRY=""; [ "${2:-}" = "--dry-run" ] && DRY=1
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "usage: scripts/release.sh X.Y.Z [--dry-run]"
TAG="v$VERSION"

cd "$(git rev-parse --show-toplevel)"
[ "$(git branch --show-current)" = main ] || die "not on main"
OTHER=$(git status --porcelain | grep -v ' CHANGELOG.md$' || true)
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" >&2; die "uncommitted changes besides CHANGELOG.md"; }

git fetch --quiet --tags origin
[ "$(git rev-list --count HEAD..origin/main)" = 0 ] || die "origin/main has commits you don't: pull first"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "$TAG already exists"
LATEST=$(git tag -l 'v*' --sort=-v:refname | head -n1)
if [ -n "$LATEST" ] && [ "$(printf '%s\n%s\n' "${LATEST#v}" "$VERSION" | sort -V | tail -n1)" != "$VERSION" ]; then
  die "$TAG is not newer than $LATEST"
fi

NOTES=$(awk -v t="$TAG" '/^## \[/ { p = index($0, "## [" t "]") == 1; next } p' CHANGELOG.md)
[ -n "$(printf '%s' "$NOTES" | tr -d '[:space:]')" ] || die "CHANGELOG.md has no '## [$TAG]' section"

command -v gh >/dev/null || die "gh (GitHub CLI) is needed for the GitHub release"
gh auth status >/dev/null 2>&1 || die "gh is not logged in"

echo "== tests"
(cd server && npm ci --silent) && npm test >/dev/null || die "tests failed"

echo "== release $TAG (previous: ${LATEST:-none})"
printf '%s\n' "$NOTES"
if [ -n "$DRY" ]; then echo "== dry run: nothing changed"; exit 0; fi

sed -i -E "s/^(  \"version\": )\"[^\"]*\"/\1\"$VERSION\"/" package.json
grep -q "\"version\": \"$VERSION\"" package.json || die "could not set the version in package.json"
git add package.json CHANGELOG.md
git commit -q -m "Release $TAG"
git tag -a "$TAG" -m "$TAG"

echo "== push to GitLab (CI: GitLab release + Docker Hub/GHCR images)"
git push --quiet origin main "$TAG"
echo "== push to GitHub too (the GitLab mirror may lag; gh release needs the tag now)"
git push --quiet "$GITHUB_URL" main "$TAG"

NOTES_FILE=$(mktemp); trap 'rm -f "$NOTES_FILE"' EXIT
printf '%s\n' "$NOTES" > "$NOTES_FILE"
gh release create "$TAG" -R "$GITHUB_REPO" --title "$TAG" --notes-file "$NOTES_FILE" --verify-tag

PROJECT=$(git remote get-url origin | sed -E 's#^.*[:/]([^/]+/[^/]+)\.git$#\1#')
echo "== done. Pipeline: https://gitlab.roste.org/$PROJECT/-/pipelines?ref=$TAG"
