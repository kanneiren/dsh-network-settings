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

## Ground rules

- Network Core is deterministic. No LLM in any diagnostic path.
- UI must use DSH primitives and `--dsw-alias-*` tokens only.
- Client never executes platform commands; add an RPC endpoint in
  `src/host/index.ts` and a typed method in `src/client/service.ts`.
- Every persistent change uses snapshot → preview → confirm → apply.
- Secrets are redacted before persistence or RPC responses.

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
