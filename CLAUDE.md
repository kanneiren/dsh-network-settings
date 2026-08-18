# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run typecheck        # type-check host + client (two tsconfigs)
npm test                 # node:test unit suite (tests/unit/)
npm run test:ui          # vitest React + CSS token tests (tests/ui/)
npm run test:all         # unit + UI together
npm run build            # clean + tsdown (outputs to lib/)
```

Run a single unit test file:

```bash
node --test tests/unit/diagnose.test.ts
```

Windows/WSL read-only smoke (no live probes, no WSL required):

```powershell
node --experimental-strip-types src/host/smoke.ts --no-probes --no-wsl
```

Full smoke with diagnostics only:

```bash
npm run diagnose
```

E2E against a running DSH profile:

```bash
DSH_URL=http://127.0.0.1:3091 node tests/e2e/smoke.mjs
```

Reload built code into a running DSH (both profiles link `node_modules/dsh-network-settings` to this checkout):

```powershell
pwsh scripts/dev-windows-reload.ps1   # build + restart the Windows instance (port 3091)
pwsh scripts/dev-wsl-reload.ps1       # build + restart the WSL instance (port 3092)
```

## Architecture

This is a **DSH (DeepSeek Harness) plugin** that splits into two halves compiled by `tsdown`:

- **Host half** (`src/host/`) — runs in the DSH Node process; performs all system calls via PowerShell/WSL. Registers a single RPC channel `/dsh-network-settings` with `authority: loopback`.
- **Client half** (`src/client/`) — React settings UI injected into DSH Settings → Plugins → Network. Never executes platform commands; all system interaction goes through `src/client/service.ts` typed RPC calls.

### Two runtime models

Runtime is detected once at inspection time and drives every subsequent module:

- `WINDOWS_NATIVE` — DSH running directly in Windows
- `WSL_DISTRIBUTION` — DSH running inside a WSL distribution

The graph builder (`src/host/network/build-windows.ts` / `build-wsl.ts`) selects the correct path model. `UNSUPPORTED` short-circuits immediately.

### Data flow

```
Client (React) → service.ts RPC → src/host/index.ts (switch on endpoint)
  → network/index.ts (orchestrate)
    → windows/inspect.ts or wsl/* (static inspection)
    → probe/probe.ts (DNS → TCP → TLS → HTTP layers)
    → network/build-*.ts (NetworkPathGraph)
    → network/drift.ts (ConfigurationDrift diagnostics)
    → diagnose/rules.ts (deterministic rules)
    → repair/catalog.ts (repair recommendations)
```

### Key type boundary

- `src/host/network/types.ts` — authoritative host-side types (`NetworkPathGraph`, `PathNode`, `PathEdge`, `ProxyConfiguration`, `ProxyEndpoint`, `NetworkDiagnostic`, …)
- `src/client/contract.ts` — client-side mirror of wire types

### Repair lifecycle

Every persistent change must follow: **read → snapshot → diff preview → user confirm → apply → re-detect → verify**. A successful command is never treated as a successful network repair.

### Adding an RPC endpoint

Host (`src/host/index.ts`):
```ts
case 'my/endpoint':
  return ok(await myHostFunction())
```

Client service (`src/client/service.ts`):
```ts
async myEndpoint() {
  const result = await connection.rpc.call<T>(CHANNEL, 'my/endpoint', {})
  return result.ok ? result.value : undefined
}
```

## Style constraints

- **UI copy** must go through `src/client/locales.ts` (both `en` and `zh`).
- **Client CSS** uses only `--dsw-alias-*` tokens — no literal colors, no global selectors, no dark-theme selectors. The `tests/ui/css-tokens.test.ts` guard enforces this.
- **Network Core is deterministic** — no LLM in any diagnostic path.
- **Secrets** must be redacted via `src/host/redact.ts` before any persistence or RPC response.
- UI components use DSH primitives (`@deepseek-ai/dsh-client-ui-primitives`) — mocked in `tests/ui/primitives-mock.tsx` for tests.
- **Probe timeouts are mandatory**: every layer carries a timeout and the whole inspection runs under one deadline (`inspectNetwork`). Never add an unbounded await.
- **Repair recommendations** are gated by `RECOMMEND_CONFIDENCE_THRESHOLD` (0.85) and the whitelist in `src/host/repair/catalog.ts`; admin/reboot/high-risk ops stay manual-only.
- **Dual runtime**: when DSH runs inside WSL, the current distribution is probed via local `/bin/sh` (never an interop round-trip); Windows-side operations require interop and must degrade with a clear message.
- **Default check target** is DeepSeek (`defaultTarget` in `src/host/network/index.ts`).

## Test layout

| Suite | Runner | Location |
|---|---|---|
| Unit (parsers, builders, diagnosis) | `node --test` | `tests/unit/*.test.ts` |
| UI (React components, CSS tokens) | vitest + jsdom | `tests/ui/*.test.tsx` |
| E2E (live DSH instance) | Playwright | `tests/e2e/smoke.mjs` |

Unit tests use inline fixtures; no real system calls. UI tests mock the primitives and RPC service.
