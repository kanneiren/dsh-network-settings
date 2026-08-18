# dsh-network-settings

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  Windows / WSL network path diagnostics and safe repair for
  <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"/>
  <img src="https://img.shields.io/badge/platform-Windows%20%2B%20WSL-3572A5" alt="Platform"/>
</p>

---

## Highlights

- **Two runtime models only** — automatically detects `WINDOWS_NATIVE` or
  `WSL_DISTRIBUTION`; no manual Windows/WSL mode switch.
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

---

## Install

```powershell
dsh plugin --profile web add dsh-network-settings
```

Open **Settings → Plugins → Network**.

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
- Platform: Windows 10/11 with WSL
- All network checks are local and read-only unless you explicitly confirm a
  change.

## Privacy

No telemetry. Reports and snapshots are redacted locally before persistence.

## License

[MIT](LICENSE)
