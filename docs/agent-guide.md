# Agent Guide

This guide is for coding agents and maintainers working on
`dsh-network-settings`.

## Commands

```bash
npm run typecheck   # host + client TypeScript
npm test            # node:test unit suite
npm run test:ui     # vitest React/CSS tests
npm run build       # rebuild lib/ host and client bundle
npm run test:all    # unit + UI
```

Windows/WSL read-only smoke:

```powershell
node --experimental-strip-types src/host/smoke.ts --no-probes --no-wsl
```

Reload built code into a running DSH (both profiles link
`node_modules/dsh-network-settings` to this checkout):

```powershell
pwsh scripts/dev-windows-reload.ps1   # build + restart the Windows instance (port 3091)
pwsh scripts/dev-wsl-reload.ps1       # build + restart the WSL instance (port 3092)
```

## Ground rules

- Network Core is deterministic. No LLM in any diagnostic path.
- UI must use DSH primitives and `--dsw-alias-*` tokens only.
- UI conventions: type scale 16/14/13/12 (nothing below 12px), 4px spacing
  grid (4/8/12/16), responsive behavior via container queries on
  `.section` (the settings dialog caps at 800px — viewport breakpoints lie).
  Operation metadata rows use `MetaBadges`, not joined sentences.
- Client never executes platform commands; add an RPC endpoint in
  `src/host/index.ts` and a typed method in `src/client/service.ts`.
- Every persistent change uses snapshot → preview → confirm → apply.
- Secrets are redacted before persistence or RPC responses.
- Release flow: bump `package.json`, add a `## <tag>` section to
  `CHANGELOG.md`, run the gates, tag, then
  `GITHUB_TOKEN=... bash scripts/github-publish.sh` (pushes main and
  creates the GitHub Release from the changelog section).

## Diagnostic report contract

`src/client/report.ts` produces the clipboard report pasted to agents. It is
a parseable contract, keep it stable:

- Fixed English section headers regardless of UI locale, plus a
  `report-version` line — bump it whenever the layout changes in a way
  scripts/agents could misread.
- `## TL;DR` first: runtime model, path status and target, readable first
  failure, recommended repair, top diagnoses.
- Machine-stable identifiers everywhere: diagnosis/evidence/action codes,
  probe target ids (evidence refs are `probe:<target.id>:<layer>`), status
  enums; long technical lines are truncated.
- Works without an inspection (diagnosis-only briefing in the cached state).

## Data model

Core types live in `src/host/network/types.ts`. The client mirror lives in
`src/client/contract.ts`.

```text
NetworkPathGraph
├─ model: WINDOWS_NATIVE | WSL_DISTRIBUTION
├─ runtime
├─ target
├─ dshPath
├─ diagnostics
└─ recommendedRepair?
```

Proxy concepts are intentionally separate:

```text
ProxyConfiguration  = where the config came from
ProxyEndpoint       = host:port endpoint with state
ProxyListener       = actual listening process/PID
```

## Adding a target

Edit `PUBLIC_TARGETS` in `src/host/network/index.ts`:

```ts
{
  id: 'example',
  label: 'Example API',
  host: 'api.example.com',
  port: 443,
  url: 'https://api.example.com',
  kind: 'custom',
  display: 'api.example.com:443',
}
```

Rebuild with `npm run build`.

## Adding a diagnostic

1. Add a pure rule in `src/host/network/drift.ts` or
   `src/host/diagnose/rules.ts`.
2. Return `code`, `severity`, `confidence`, `pathIds`, `humanMessage`,
   `technicalMessage`, `evidence`, and optional `actions`.
3. Map safe actions to operations in `src/host/repair/catalog.ts`.
4. Add unit tests with fixtures.

## Adding an RPC endpoint

Host:

```ts
case 'my/endpoint':
  return ok(await myHostFunction())
```

Client service:

```ts
async myEndpoint() {
  const result = await connection.rpc.call<T>(CHANNEL, 'my/endpoint', {})
  return result.ok ? result.value : undefined
}
```

## Testing

- Unit fixtures for builders live in `tests/unit/path-builder.test.ts`.
- Runtime detection cases live in `tests/unit/runtime-detect.test.ts`.
- UI graph tests live in `tests/ui/network-graph.test.tsx`.
- Keep client tests isolated from real system calls with mock services.

## Release notes

- `prepublishOnly` runs typecheck, unit tests, UI tests and build.
- `npm pack --dry-run` verifies the published file set.
- Do not publish until `repository` / `homepage` / `bugs` fields point at the
  real GitHub repository.
