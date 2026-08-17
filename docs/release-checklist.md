# Release Checklist

## Before publishing

- [ ] Set the real GitHub repository URL in `package.json`:
      `repository`, `homepage`, `bugs`.
- [ ] Confirm the npm package name `dsh-network-settings` is available.
- [ ] Choose the first release version (currently `0.1.0`).
- [ ] Review README/README.zh-CN for current behavior.
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

## Publishing

```bash
npm publish
```

- [ ] Configure the npm token for GitHub Actions (`NPM_TOKEN`) if using CI.
- [ ] Create a GitHub Release with the generated tarball/SHA.

## After publishing

- [ ] Submit the plugin to the Awesome DSH Plugins list.
- [ ] Tag the release commit (`v0.1.0`).
- [ ] Update the changelog with user-facing behavior.
