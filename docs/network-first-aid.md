# Network First Aid

## When does it appear?

“网络急救” appears only after a detection run produces at least one
diagnosis. It has two distinct roles:

```text
推荐修复    = the diagnosis decides the minimal repair
其它修复操作 = manual catalog, not automatically recommended
```

A diagnosis with no safe automatic action still shows the section, but the
recommended area stays empty.

## Recommended operations

These can appear automatically when a diagnostic action maps to them:

| Operation | Scope | Risk | Typical trigger |
|---|---|---|---|
| Clear current DSH process proxy | `dsh.process` | low | stale DSH proxy drift |
| Clear current Windows user env proxy | `windows.env.user` | low | env conflict/stale env |
| Disable and clear WinINet user proxy | `windows.wininet` | low | stale Windows proxy |
| Clear WinHTTP user proxy | `windows.winhttp.user` | low | stale WinHTTP proxy |
| Enable WSL autoProxy | `windows.wslconfig` | medium, WSL restart | WSL proxy diagnosis |
| Flush DNS cache | system command | low | DNS diagnosis |

## Manual catalog

These are never recommended automatically:

| Operation | Risk | Admin | Restart |
|---|---|---|---|
| Clear machine env proxy | medium | yes | no |
| Reset WinHTTP machine proxy to DIRECT | medium | yes | no |
| Flush DNS cache | low | no | no |
| Reset Winsock | high | yes | yes |
| Reset TCP/IP | high | yes | yes |

## File-level repairs

Only when a concrete line is found:

```text
WSL shell proxy line   → delete this line
Hosts entry affecting target → delete this entry
```

Both create a backup and a preview before applying.

## Reliability

- Low-risk scoped changes are safe: snapshot first, diff preview, user
  confirmation, rollback available.
- Medium-risk changes may affect DSH-external software or need a WSL restart.
- High-risk resets are manual-only and explicitly state admin/reboot/recovery.

## Verification

After any repair the plugin re-runs detection automatically. A successful
command is not considered a successful network repair.
