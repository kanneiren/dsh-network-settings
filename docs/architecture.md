# Architecture

## Overview

```text
DSH Settings (React)
        │ typed RPC (/dsh-network-settings)
        ▼
Host half (DSH Node process)
        │
        ├─ Runtime detection: WINDOWS_NATIVE / WSL_DISTRIBUTION / UNSUPPORTED
        ├─ Windows/WSL static inspection
        ├─ Layered probes: DNS → TCP → TLS → HTTP
        ├─ NetworkPathGraph builder (DSH-only path)
        ├─ Configuration Drift rules
        ├─ Legacy deterministic diagnosis rules
        └─ Scoped repair / snapshot / rollback
```

The client never executes platform commands. Every system action goes through
the host RPC channel with `authority: loopback`.

## Modules

### `src/host/network`

| File | Responsibility |
|---|---|
| `types.ts` | JSON-safe graph types: `NetworkPathGraph`, `NetworkPath`, `PathNode`, `PathEdge`, `Evidence`, `ProxyConfiguration`, `ProxyEndpoint`, `NetworkDiagnostic`, `NetworkPathSummary` |
| `runtime.ts` | Static runtime detection from `process.platform`, `/proc/version`, `WSL_DISTRO_NAME`, `/etc/os-release`, cgroup |
| `survey.ts` | Read-only survey consumed by builders |
| `build-windows.ts` | `WINDOWS_NATIVE` DSH path builder |
| `build-wsl.ts` | `WSL_DISTRIBUTION` DSH path builder |
| `drift.ts` | Configuration Drift diagnostics + repair hints |
| `index.ts` | Orchestration: target list, graph building, summaries |

### `src/host`

| File/Area | Responsibility |
|---|---|
| `windows/inspect.ts` | PowerShell inspection: adapters, routes, WinINet, WinHTTP, env, listeners, Hosts, gateway ICMP/neighbor |
| `wsl/*` | `wsl.exe` list parsing, `.wslconfig`, `/etc/wsl.conf`, distribution facts |
| `probe/net.ts` | DNS/TCP/TLS/HTTP probes, repeated sampling for stability mode |
| `probe/probe.ts` | DIRECT/PROXY orchestration and first-failure layer mapping |
| `diagnose/rules.ts` | Deterministic diagnosis rules |
| `configure/*` | Scoped configuration with preview/snapshot/apply |
| `repair/*` | Operation catalog, recommendations, WSL/Hosts repairs, advanced actions |
| `redact.ts` | Secret redaction for reports and snapshots |

### `src/client`

| File | Responsibility |
|---|---|
| `NetworkTab.tsx` | Settings tab entry, actions, target switcher, report copy |
| `NetworkGraph.tsx` | Diagnosis summary, first-failure details, DSH path lane |
| `NetworkConfig.tsx` | Hierarchical configuration with progressive disclosure |
| `RepairSection.tsx` | Recommended repairs + manual operations + rollback/history |
| `AdvancedSection.tsx` | High-risk system recovery actions with explicit confirmation |
| `service.ts` | Typed RPC client over the DSH Connection channel |
| `contract.ts` | Client-side wire types |

## Two runtime models

```text
WINDOWS_NATIVE
  DSH → Windows → [Proxy] → Adapter → Gateway → Internet → Target

WSL_DISTRIBUTION
  DSH → Distribution → WSL Network (NAT/Mirrored/…) → Windows Host
       → [Proxy] → Adapter → Gateway → Internet → Target
```

Distribution identity and WSL network layer are separate concepts. NAT is an
edge translation semantic, never drawn as a fake server. Mirrored/Bridged/
VirtioProxy keep their own edge relations.

## Probe layers

```text
DNS
  ↓ success
TCP (3 attempts in stability mode)
  ↓ success
TLS
  ↓ success
HTTP HEAD
```

Proxy paths delegate DNS to the proxy and use CONNECT for HTTPS targets.

## Configuration Drift

A difference is not an error. Drift becomes a diagnostic only when:

- the DSH proxy endpoint is demonstrably gone/unreachable;
- WSL can reach Windows Host but not the configured proxy;
- WinHTTP still points at a port with no listener.

Healthy configuration differences are reported as `info`.

## Repair guarantees

Every persistent change:

```text
read current value → snapshot → diff preview → user confirmation
→ apply → re-detect → verify
```

A successful command is never treated as a successful network repair.
