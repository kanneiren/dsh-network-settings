# dsh-network-settings

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  Windows / WSL / macOS network path diagnostics and safe repair for
  <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"/>
  <img src="https://img.shields.io/badge/platform-Windows%20%2B%20WSL%20%2B%20macOS-3572A5" alt="Platform"/>
</p>

---

## Highlights

- **Three runtime models** — automatically detects `WINDOWS_NATIVE`,
  `WSL_DISTRIBUTION`, or `MACOS_NATIVE`.
- **DSH path graph** — shows the actual DSH network path, DNS side branch and
  first failing edge; a TUN/VPN adapter is chained with the physical uplink
  NIC and the real gateway behind it.
- **Configuration Drift** — finds stale proxy configuration without treating
  healthy configuration differences as errors.
- **Single / stability checks** — one-shot diagnostics plus repeated TCP/HTTP
  sampling; DeepSeek is the default target and switching is always available.
  Every probe layer and the whole check carry hard timeouts, so a broken
  network never stalls the page.
- **Agent-ready report** — one click copies a stable-format Markdown report
  (fixed English headers, `report-version`, TL;DR first, machine-readable
  codes and per-layer probe latency).
- **Recommended repairs** — only high-confidence diagnoses mapped to common
  low-risk operations (clear proxy-residue env vars, disable system proxy,
  flush DNS cache); admin and high-risk operations stay in the manual catalog.
- **Safe repair** — snapshot → diff → confirm → apply → re-detect, with
  rollback for persistent changes.
- **DSH-native UI** — uses DSH primitives and `--dsw-*` tokens only.

## Screenshots

<table>
<tr><td colspan="2" align="center">

The plugin lives in **DSH Settings → Plugins → Network** (click images to
enlarge)

<a href="docs/images/wsl-in-dsh.png"><img src="docs/images/wsl-in-dsh.png" width="720" alt="The plugin inside the DSH settings UI"></a>

</td></tr>
<tr>
<td width="50%" align="center">

<a href="docs/images/wsl-path-graph.png"><img src="docs/images/wsl-path-graph.png" width="380" alt="DSH network path in WSL"></a>

<sub>DSH inside a WSL distribution: DSH → distro → WSL NAT → Windows Host → proxy TUN → physical NIC → gateway → target</sub>

</td>
<td width="50%" align="center">

<a href="docs/images/win-path-graph.png"><img src="docs/images/win-path-graph.png" width="380" alt="DSH network path on Windows"></a>

<sub>Windows-native DSH path, chaining the physical uplink behind a TUN/VPN adapter</sub>

</td>
</tr>
<tr>
<td width="42%" align="center" valign="top">

<a href="docs/images/win-network-config.png"><img src="docs/images/win-network-config.png" width="300" alt="Network configuration"></a>

<sub>Grouped network configuration</sub>

</td>
<td width="58%" valign="top">

**Network configuration** is grouped by source, every entry traceable:

- **Windows proxy**: WinINet / WinHTTP state, proxy environment variables
  across all three scopes (both letter cases)
- **DSH process environment**: runtime model, egress (direct / via proxy
  with address), **verified listener process** behind the proxy port,
  process proxy variables
- **WSL**: distribution environment, network mode (NAT / mirrored),
  `/etc/wsl.conf` and `.wslconfig`
- **Advanced**: DNS cache, interfaces & routes, Hosts, first-aid actions

Every persistent change follows snapshot → preview → confirm → apply →
rollback.

</td>
</tr>
</table>

---

## Install

From the npm registry (recommended — prebuilt, no extra configuration):

```powershell
dsh plugin --profile web add dsh-network-settings
```

Re-running the same command updates the plugin to the latest version.
Versions published very recently may be held back by pnpm's
`minimumReleaseAge` supply-chain policy — install with an explicit
version (`dsh plugin --profile web add dsh-network-settings@<version>`)
or retry later.

Open **Settings → Plugins → Network**.

<details>
<summary>Install directly from GitHub (alternative)</summary>

```powershell
dsh plugin --profile web add github:kanneiren/dsh-network-settings
```

GitHub installs build the plugin on install (`prepare` script), and pnpm
blocks build scripts of git-hosted packages until you approve them. If the
install fails with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`, copy the exact
`allowBuilds` key printed in that error message into
`%UserProfile%\.dsh\profiles\<profile>\pnpm-workspace.yaml` and re-run the
install command. The key looks like:

```yaml
allowBuilds:
  dsh-network-settings@https://codeload.github.com/kanneiren/dsh-network-settings/tar.gz/<commit>: true
```

The key pins the resolved commit hash, so every new version asks for
approval once more (pnpm does not accept wildcards for git-hosted
packages). The npm registry install above has no such step.

</details>

---

## Usage

```text
Open the page
  → cached summary only, no probes run
Click [Single check]
  → full inspection + current target probe + DSH path graph
Click [Stability check]
  → repeated TCP/HTTP sampling
Click [Copy network report]
  → Markdown report for an Agent
```

---

## Docs

| Document | Content |
|---|---|
| [Architecture](docs/architecture.md) | modules, runtime models, probes, repair guarantees |
| [Diagnostics](docs/diagnostics.md) | how results are produced and displayed |
| [Network first aid](docs/network-first-aid.md) | operations, risks, reliability |
| [Agent guide](docs/agent-guide.md) | development commands and extension points |
| [Release checklist](docs/release-checklist.md) | publishing steps |
| [Network path & drift](docs/network-path-graph.md) | graph/UI behavior details |

---

## Support

- DSH: `@deepseek-ai/dsh >= 0.1.0-rc.6` (Web profile)
- Platform: Windows 10/11 with WSL; macOS (CI-verified, real-machine
  validation pending)
- All network checks are local and read-only unless you explicitly confirm a
  change.

## Privacy

No telemetry. Reports and snapshots are redacted locally before persistence.

## License

[MIT](LICENSE)
