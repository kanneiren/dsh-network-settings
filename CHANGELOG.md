# Changelog

## v0.3.0

### macOS support (new runtime model)

- `MACOS_NATIVE` runtime detected on darwin; facts collected via `scutil`,
  `networksetup`, `route`, `lsof` and `sw_vers` — no PowerShell or wsl.exe
- Shell-profile proxy residue detection (~/.zshenv, ~/.zprofile, …) plus
  the scutil system proxy: `MAC_SHELL_PROXY_RESIDUE` (error) and
  `MAC_SCUTIL_PROXY_STALE` (warning) fire on the macOS "closed the proxy
  app" classic
- macOS path graph (direct and proxy) reuses the shared vocabulary; DNS
  branch shows resolved addresses
- macOS configuration panel in the UI: system proxy (scutil), shell-profile
  env vars, DNS resolvers
- CI: macos-latest in the test matrix with real macOS smoke, fault-lab
  S1/S5/S6 on darwin, and fixture capture from the runner (recorded
  command outputs committed as `tests/fixtures/mac/`)
- Architecture: `NetworkInspection` container neutralized — `windows`
  optional, `dsh` and `modelServices` promoted to top level (they belong
  to DSH, not to any host OS); `windowsOf()` accessor keeps all Windows
  consumers unchanged

## v0.2.1

### Fixes

- WSL graphs now show DNS resolution results (`host → address`) in the DNS
  side branch, matching the Windows side. The WSL DNS probe previously
  kept only raw resolver output and never reported the parsed addresses.

### Documentation

- README (en/zh) gained a screenshot gallery: the plugin's position inside
  DSH, the WSL and Windows path lanes, and the grouped network
  configuration. Private IP addresses are masked to their first two octets
  and sidebar content is blurred in the captures.

## v0.2.0

User-facing changes since v0.1.0. Full commit history on GitHub.

### Detection robustness

- Every probe layer now carries a hard timeout (DNS 4s / TCP 4s / TLS 6s /
  HTTP 8s, covering response headers and body) and the whole check runs
  under one deadline — a broken network can no longer stall the page for
  minutes. Canceled probes resolve with explicit timeout codes.
- When DSH runs inside a WSL distribution, the current distribution is
  probed and inspected through local `/bin/sh` (no interop round-trip,
  which was slow and could hang). With Windows interop disabled, the graph
  still works from local files.
- The path graph now chains the physical uplink behind a TUN/VPN adapter:
  a proxy client's virtual NIC (e.g. `198.18.0.1`) no longer shadows the
  real Wi-Fi/Ethernet hop and gateway. Fake-IP addresses are annotated in
  the UI.

### Repair recommendations

- Recommendations are gated: only diagnoses with confidence ≥ 0.85 mapped
  to common low-risk operations (flush DNS, clear proxy-residue env vars,
  disable system proxy, clear the DSH process proxy) show a recommended
  button. Admin/UAC, reboot-requiring and non-recoverable operations stay
  in the manual catalog.
- Disabling the WinINet system proxy now notifies WinINet
  (InternetSetOption), matching the known-good manual fix for
  "closed the proxy app, no internet anymore".

### Report

- The copied report is now a stable, parseable contract: fixed English
  section headers, `report-version`, a TL;DR header (runtime model, path
  status, readable first failure, recommended repair), proxy endpoint
  table with listener state, full per-scope proxy env vars in both letter
  cases, per-layer probe latency, and truncated long lines. Works without
  an inspection (diagnosis-only briefing) in the cached state.

### UI

- Type scale 16/14/13/12 with nothing below 12px (11px text was unreadable
  at laptop scaling); hierarchy via weight and label tokens.
- 4px spacing grid with more breathing room; responsive layout keyed off
  the DSH panel width via container queries (measured: the settings dialog
  caps at 800px).
- DeepSeek is the default check target; the target switcher is available
  in every state (standby, cached, result).
- Operation metadata rows are now tag badges; the DSH process environment
  card was redesigned (state-driven egress with verified listener process);
  machine-scope proxy env vars render when set.
- WSL-side DSH card shows the Linux runtime, egress and proxy variables.

### Performance

- Repair preview/apply reads use a lightweight PowerShell query instead of
  the full system inspection: ~7.5s → ~1s per read (measured).

### Fixes

- WSL dev restart script keeps instances alive (setsid) instead of dying
  ~10s after the launching session exits; stale manager `--patch`
  references are stripped automatically.
- Hosts file read/write works when DSH runs inside WSL (`/mnt/c` paths,
  Windows drive-letter conversion for elevated fallback).
- Windows-side operations fail with an actionable message when interop is
  disabled, instead of a raw ENOENT.

## v0.1.0

Initial public release: two runtime models (Windows native / WSL
distribution), DSH path graph with DNS side branch, layered probes,
configuration drift detection, deterministic diagnosis rules, snapshot →
preview → confirm → apply → rollback repair flow, agent-friendly Markdown
report, bilingual DSH-native UI.
