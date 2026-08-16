# dsh-network-settings

DSH Network Settings (DSH 网络设置) is a lightweight community plugin for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It adds a
**Network** tab under **Settings → Plugins** for Windows + WSL environments.

Chinese: [README.zh-CN.md](README.zh-CN.md)

## What it does

```text
Open the page → see cached status → run one full check
→ understand the problem in plain language
→ apply a scoped, previewed and reversible fix when one exists
```

- Read-only Windows network inspection: interfaces, IPv4/IPv6, gateways,
  routes, DNS, DHCP, WinINet user proxy, WinHTTP user/machine proxy,
  Process/User/Machine proxy environment variables, DSH process environment,
  Hosts overrides, listening ports/processes.
- WSL discovery (`wsl.exe --list --verbose` family) with a parser that handles
  UTF-16 output, localized headers and distribution names with spaces.
  Stopped distributions are never started automatically.
- Per-running-distribution checks: Windows host reachability, DNS, direct
  internet, Windows proxy endpoint, proxy internet.
- Model-service checks are HTTP reachability only (HEAD to the configured
  base URL, no Authorization header): **no prompt is sent and no tokens are
  consumed**.
- Layered probes: DNS → TCP → TLS → HTTP(S), over DIRECT and PROXY paths.
- Deterministic diagnosis (no LLM): stale DSH proxy env, proxy endpoint
  unreachable/unusable, DNS failure, TLS failure, env scope conflicts, WSL
  proxy unreachable, stale WSL autoProxy, Hosts overrides.
- Scoped configuration with preview + confirmation: WinINet, WinHTTP,
  Windows environment variables, current DSH process. Machine-level changes
  request UAC only when executed.
- Snapshots before every persistent change; undo last change and rollback by
  scope; redacted diagnostic report copy.
- Advanced first aid as separate operations: `ipconfig /flushdns`,
  `netsh winhttp reset proxy`, `netsh winsock reset`, `netsh int ip reset`.

## Support

- **DSH**: `@deepseek-ai/dsh >= 0.1.0-rc.6` (Web profile).
- **Platforms**: Windows 10/11 with WSL; Windows + WSL is the target
  environment. Other platforms show a degraded read-only page.
- **Windows support range**: read-only inspection on standard user rights;
  user-scoped repairs; machine-scoped repairs via explicit UAC.
- **WSL support range**: WSL1/WSL2, any distribution. Capability detection is
  used instead of distribution detection; identity is display-only.
- **Permissions**: see [Permissions](#permissions).

## Install

```powershell
dsh plugin --profile web add dsh-network-settings
```

Then restart the DSH Web profile. The plugin declares `dsh.bundle`, so
`dsh plugin` adds it to the profile bundle list automatically.

For a git checkout, pin a commit and allow pnpm to run the package `prepare`
script as described by `dsh plugin`'s output.

## Uninstall

```powershell
dsh plugin --profile web remove dsh-network-settings
```

Then restart DSH. Snapshots and the last report remain under
`$DSH_HOME/dsh-network-settings/` for inspection; delete that directory to
remove all plugin data.

## Permissions

| Operation | Permission |
|---|---|
| Page open, status, full detection | None |
| WinINet / WinHTTP user / User env / DSH process | Current user, no UAC |
| Machine env / machine WinHTTP | UAC only when that operation is executed |
| Starting a stopped WSL distribution | Only via the explicit `启动并检测` action |

## Privacy

All checks run locally. No configuration, IP, Hosts, proxy address, or report
is uploaded; no telemetry is collected. Reports and snapshots are redacted
(API keys, tokens, cookies, authorization values, passwords, URL/proxy
credentials).

## Troubleshooting

- **Network tab is missing**: confirm the plugin is in the profile bundle list
  and restart the Web profile.
- **Page says `未检测`**: click `一键全面检测`. Opening the page only reads
  cached results and static configuration by design.
- **WSL shows `未运行`**: stopped distributions are never started
  automatically. Use the explicit start-and-test action.
- **A repair is disabled**: the plugin only applies high-confidence scoped
  fixes. Expand `查看详情` and copy the diagnostic report for manual help.
- **"Flush DNS" keeps being recommended**: the DNS problem is not cache
  related (commonly VPN/proxy DNS split routing). Flushing again will not
  help; copy the agent diagnostic report instead.
- **Machine-scope repair failed**: accept the UAC prompt for that specific
  operation, then retry.

## License

MIT. See [LICENSE](LICENSE).
