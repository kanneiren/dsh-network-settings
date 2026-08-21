# Release Checklist

## Before publishing

- [ ] Bump `version` in `package.json` and the probe `User-Agent` strings in
      `src/host/probe/net.ts` to match.
- [ ] Add a `## <tag>` section to `CHANGELOG.md` with user-facing changes
      (this section becomes the GitHub Release body).
- [ ] Review README/README.en for current behavior.
- [ ] Run:
      ```bash
      npm run typecheck
      npm test
      npm run test:ui
      npm run build
      npm pack --dry-run
      ```
- [ ] Install the packed tarball into an isolated DSH profile and verify
      Settings → Plugins → Network on Windows and WSL.
- [ ] Ensure `lib/` is rebuilt and included in `files`.
- [ ] Tag the release commit: `git tag -a v<version>`.

## Publishing

GitHub (source + release):

```bash
GITHUB_TOKEN=<pat with repo scope> bash scripts/github-publish.sh
```

- Tag defaults to the `package.json` version; the release body is the
  matching `CHANGELOG.md` section (falls back to generated notes).
- The script pushes `main` (asks before force-push when remote history
  diverged) and creates the GitHub Release via the API.

npm (package):

```bash
npm publish
```

- [ ] `npm publish` packs the current working tree, not the git tag —
      publish from a clean worktree of the tagged commit
      (`git worktree add ../publish-v<version> v<version>`, then
      `npm ci && npm publish` there) so uncommitted local changes never
      leak into the tarball.
- [ ] Configure the npm token for GitHub Actions (`NPM_TOKEN`) if using CI.

## After publishing

- [ ] Verify the GitHub Release has no unnecessary assets — the npm
      registry is the install source; a Release tarball is redundant unless
      there is a specific offline-installation requirement.

- [ ] Submit the plugin to the Awesome DSH Plugins list.
- [ ] Verify the release page renders the changelog section correctly.
