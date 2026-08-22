# Agent Guide

This guide is for coding agents and maintainers working on
`dsh-network-settings`.

## Documentation policy

`docs/` holds living documentation only (architecture, diagnostics,
first aid, path graph, this guide, release checklist). Development
process notes — phase plans, progress snapshots, research dumps,
strategy memos — belong in `.research/` (gitignored), never in `docs/`:
stale process notes mislead agents that explore the repository, and git
history already preserves everything.

## Commands

```bash
npm run typecheck   # host + client TypeScript
npm test            # node:test unit suite (includes architecture constraints)
npm run test:ui     # vitest React/CSS tests
npm run build       # rebuild lib/ host and client bundle
npm run test:all    # unit + UI
npm run fault-lab   # proxy-fault scenarios (in-process env injection)
```

Read-only smoke (any platform):

```bash
node --experimental-strip-types src/host/smoke.ts --no-probes --no-wsl
```

Reload built code into a running DSH (both profiles link
`node_modules/dsh-network-settings` to this checkout):

```powershell
pwsh scripts/dev-windows-reload.ps1   # build + restart the Windows instance (port 3080)
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
- **Architecture constraints are enforced by tests**
  (`tests/unit/architecture.test.ts`). Four rules:
  1. L3 pure core (graph builders, diagnosis rules) must not have runtime
     imports from effectful layers (collectors, probes, configure, repair).
     Type-only imports are allowed.
  2. Client must not import from host platform collectors.
  3. Diagnosis rules must not spawn processes or reference child_process.
  4. UI components must not scatter `runtime.type ===` checks (max 8 per
     component; use `platformOf()` helper to concentrate).
- Release flow: bump `package.json`, add a `## <tag>` section to
  `CHANGELOG.md`, run the gates, tag, then
  `GITHUB_TOKEN=... bash scripts/github-publish.sh` (pushes main and
  creates the GitHub Release from the changelog section).

## Deep Module conventions

Modules are organised by Ousterhout's deep module principle: lots of
functionality behind a narrow interface. See `docs/architecture.md` for
the full annotations. Key rules:

- Each module has one public facade (look for `Module facade:` headers).
  Exports outside the facade are internal test seams — never import them
  across modules; unexport helpers that no longer have external consumers.
- Graph builders use shared node factories (`processNode()`,
  `gatewayNode()`, `internetNode()`, `targetNode()`) from
  `network/shared.ts`. Don't create inline node object literals in
  builders — call the factory with platform-specific data.
- `NetworkPathGraph` represents the DSH outbound path only. Don't add
  firewall rules, VPN inventory, or machine topology — create separate
  structures if needed.
- `shared.ts` is the graph construction vocabulary. Don't add non-graph
  concerns (formatters, platform helpers) — those belong in their own
  modules.

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
├─ model: WINDOWS_NATIVE | WSL_DISTRIBUTION | MACOS_NATIVE
├─ runtime
├─ target
├─ dshPath
├─ diagnostics
└─ recommendedRepair?
```

The inspection container is platform-optional:

```text
NetworkInspection
├─ windows?: WindowsInspection   ← absent on macOS
├─ macos?: MacInspection         ← absent on Windows/WSL
├─ wsl?: WslInspection           ← absent on macOS
├─ dsh: EnvironmentScopeSnapshot ← always present (belongs to DSH, not any OS)
└─ modelServices: ModelServiceTarget[]
```

Use `windowsOf(inspection)` to get Windows facts or an empty shape —
don't access `inspection.windows` directly without a guard.

## Adding a runtime model

1. Add detection in `src/host/network/runtime.ts`.
2. Create a facts collector (mirror `mac/inspect.ts`):
   command templates + exported pure parsers, fixture-driven tests.
3. Create a graph builder (mirror `network/build-mac.ts`):
   direct + proxy paths, consume shared node factories.
4. Wire dispatch in `network/index.ts`.
5. Add platform-specific repair operations in `repair/catalog.ts`
   with `platform: '<os>'` tag.
6. Capture fixtures via a CI workflow (see `.github/workflows/`).
7. Add the model to the runtime selection diagram in `docs/architecture.md`.

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
4. Tag the operation with `platform:` if it is platform-specific.
5. Add unit tests with fixtures.

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

| Test type | Location | What it covers |
|---|---|---|
| Unit (parsers, builders, diagnosis) | `tests/unit/*.test.ts` | Pure logic with recorded fixtures |
| Architecture constraints | `tests/unit/architecture.test.ts` | Layering rules via static analysis |
| Fault-lab | `scripts/fault-lab.ts` | End-to-end proxy-fault scenarios |
| UI (React + CSS tokens) | `tests/ui/*.test.tsx` | Components with mocked primitives |
| E2E (live DSH) | `tests/e2e/smoke.mjs` | Full UI via Playwright |

## Release checklist

1. Bump `package.json` version and probe `User-Agent` strings.
2. Add a `## <tag>` section to `CHANGELOG.md` (this becomes the Release body).
3. Run all gates: `npm run typecheck && npm test && npm run test:ui && npm run build`.
4. `npm pack --dry-run` to verify the file set.
5. Tag: `git tag -a v<version>`.
6. Push and create the Release:
   `GITHUB_TOKEN=<pat with repo+workflow scope> bash scripts/github-publish.sh`
7. Optionally `npm publish` (prepublishOnly re-runs all gates).
