# dsh-network-settings

<p align="center">
  Windows / WSL network path diagnostics and safe repair for
  <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a>.
  <br/>
  为 DeepSeek Harness 提供 Windows / WSL 网络链路诊断与安全修复。
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
  first failing edge.
- **Configuration Drift** — finds stale proxy configuration without treating
  healthy configuration differences as errors.
- **Single / stability checks** — one-shot diagnostics plus repeated TCP/HTTP
  sampling for unstable endpoints.
- **Agent-ready report** — one click copies a Markdown report.
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

## 中文简介

- 自动检测 **Windows 原生** 与 **WSL 发行版** 两种运行模型。
- 展示当前 **DSH 进程** 的真实网络路径、DNS 侧支和第一个失败点。
- 识别 **配置漂移**：代理配置不同但网络正常时只提示，不警告。
- 支持 **单次检测** 与 **稳定性检测**。
- 一键复制 **适合 Agent 的 Markdown 网络报告**。
- 持久化修改遵循：**快照 → 预览 → 确认 → 应用 → 重新检测 → 可回滚**。

---

## 安装与使用（中文）

```powershell
dsh plugin --profile web add dsh-network-settings
```

打开 **设置 → 插件 → 网络**：

```text
打开页面         → 只显示缓存摘要，不执行探测
[单次检测]       → 采集 + 当前目标探测 + DSH 链路图
[稳定性检测]     → TCP/HTTP 重复采样
[复制网络报告]   → 生成 Agent 可用的 Markdown 报告
```

---

## 中文文档

| 文档 | 内容 |
|---|---|
| [架构](docs/architecture.md) | 模块、运行模型、探测、修复保证 |
| [诊断流程](docs/diagnostics.md) | 诊断结果如何产生与展示 |
| [网络急救](docs/network-first-aid.md) | 操作、风险、可靠性 |
| [Agent 指南](docs/agent-guide.md) | 开发命令与扩展点 |
| [发布检查清单](docs/release-checklist.md) | 发布步骤 |
| [网络路径图与漂移](docs/network-path-graph.md) | 图与 UI 行为细节 |

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
