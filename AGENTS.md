# Agent notes

## Repos

- **GitLab is the source of truth:** `origin` = `git@gitlab.roste.org:claude/rubiks-cube.git`. Push here.
- `origin` is the only remote; the local folder is still named `rubicks-cube` (old name), the projects are `rubiks-cube`.
- **GitHub** `Darknetzz/rubiks-cube` is a public read-only copy, kept in sync by a GitLab push mirror (Settings -> Repository -> Mirroring repositories, mirror id 8): protected branches (`main`) and all tags, on every push to GitLab. Never push to GitHub or add it as a remote. It uses a fine-grained GitHub token (Contents: read/write on this repo only); when the token expires the mirror fails and needs a new one. Push only to GitLab. Do **not** add GitHub Actions; all CI runs on GitLab (`.gitlab-ci.yml`).

## Test

```sh
(cd server && npm ci) && npm test
```

## Releases

Versions are `vX.Y.Z` tags; the version also lives in `package.json`, and `CHANGELOG.md` has a `## [vX.Y.Z] - YYYY-MM-DD` section per release.

1. Add the new section at the top of `CHANGELOG.md` (leave it uncommitted).
2. Run `scripts/release.sh X.Y.Z --dry-run` to check, then `scripts/release.sh X.Y.Z`.

The script checks that you are on a clean, up-to-date `main`, that the version is newer than the last tag and that the changelog section exists, and that the tests pass. It then bumps `package.json`, commits "Release vX.Y.Z", tags, pushes `main` and the tag to GitLab, waits (up to 10 min) for the mirror to copy the tag to GitHub, and creates the GitHub release with `gh`.

The tag pipeline on GitLab then:
- creates the GitLab release from the changelog section (`release` job);
- builds `linux/amd64` + `linux/arm64` and pushes `X.Y.Z`, `X.Y`, `X` and `latest` to Docker Hub `darknetz/rubiks-cube` and GHCR `ghcr.io/darknetzz/rubiks-cube` (`docker` job, docker:dind, needs a privileged runner).

CI variables on the GitLab project: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` (Docker Hub access token), `GHCR_USERNAME`, `GHCR_TOKEN` (GitHub classic PAT, `write:packages` only). The tokens are masked and protected, so they only reach protected refs: `v*` tags are protected (Maintainers). Without any token the `docker` job is skipped.

Both registries are public; the GHCR package is linked to the GitHub repo. The image's `org.opencontainers.image.source` annotation sits on the multi-arch index, which is where GHCR reads it.
