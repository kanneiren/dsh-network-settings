# dsh-network-settings

DSH 网络设置（DSH Network Settings）是一个轻量 DeepSeek Harness 社区插件，
为 Windows + WSL 环境在 **设置 → 插件 → 网络** 中提供网络状态、诊断、配置
与恢复能力。

English: [README.md](README.md)

## 功能

```text
打开页面 → 查看最近状态 → 单次检测 / 稳定性检测
→ 看懂问题 → 复制 Agent 网络报告 → 在明确范围内安全配置/修复 → 必要时撤销
```

- 双网络模型链路图：自动检测 `WINDOWS_NATIVE` / `WSL_DISTRIBUTION`，
  展示当前 DSH 进程的完整网络路径、DNS 侧支与首次失败点。
- 单次检测与稳定性检测两个独立按钮；稳定性检测对 TCP/HTTP 重复采样，
  在图中显示成功率与失败次数。
- 一键复制适合发给 Agent 的 Markdown 网络报告。
- 配置漂移检测：识别 DSH 当前代理配置与真实运行状态的不一致；
  配置不同但均正常时只提示，不警告。
- 内置 DeepSeek / OpenAI / GitHub / npm Registry 目标。
- Windows 只读检查：接口、IPv4/IPv6、网关、路由、DNS、DHCP、
  WinINet 用户代理、WinHTTP 用户/机器代理、Windows 当前用户环境变量、
  DSH 进程环境变量、Hosts 覆盖、监听端口与进程。
- WSL 发现（`wsl.exe --list --verbose` 系列）：正确处理 UTF-16 输出、中文
  表头、名称含空格；**绝不自动启动 Stopped 发行版**。
- 每个 Running 发行版：到 Windows Host、DNS、直连互联网、Windows 代理、
  经代理互联网。
- 模型服务检测只做 HTTP 可达性（HEAD 到已配置的 base URL，不带
  Authorization 头）：**不发送 prompt，不消耗 Token**。
- 分层探测：DNS → TCP → TLS → HTTP(S)；路径区分 DIRECT / PROXY / SYSTEM。
- 确定性诊断（不依赖 LLM）：DSH 旧代理、代理 endpoint 不可达/不可用、
  DNS 失败、TLS 失败、环境变量作用域冲突、WSL 代理不可达、WSL autoProxy
  残留、Hosts 覆盖。
- 分层网络配置：代理 / DSH / WSL / 高级网络分组渐进式展示；未检测时
  显示未知，不显示 WSL 分组。
- 修改入口按来源与风险自动选择：直接按钮、打开 Windows 设置页、
  打开配置位置/复制路径、高风险系统恢复；所有持久化修改都经过
  Snapshot → Diff → 确认 → Apply → 重新检测。
- 作用域化配置：WinINet、WinHTTP、Windows 环境变量、当前 DSH 进程；
  每次修改都有 Preview + 范围说明 + 确认；机器级操作仅在执行时触发 UAC。
- 修改前自动快照；`撤销上一次修改`、按作用域回滚、配置历史、复制脱敏
  诊断报告。
- 高级网络急救逐项独立：`ipconfig /flushdns`、`netsh winhttp reset proxy`、
  `netsh winsock reset`、`netsh int ip reset`。

## 文档

- [架构](docs/architecture.md)
- [诊断流程](docs/diagnostics.md)
- [网络急救](docs/network-first-aid.md)
- [Agent 指南](docs/agent-guide.md)
- [发布检查清单](docs/release-checklist.md)
- [网络路径图与配置漂移](docs/network-path-graph.md)

## 支持范围

- **DSH**：`@deepseek-ai/dsh >= 0.1.0-rc.6`（Web profile）。
- **平台**：Windows 10/11 + WSL 为目标环境；非 Windows 平台降级为只读页。
- **Windows**：普通权限只读检测；用户级修复；机器级修复显式 UAC。
- **WSL**：WSL1/WSL2、任意发行版；按能力检测而非发行版检测；发行版身份
  仅用于展示。
- **权限**：见下文。

## 目标与 `:443` 后缀

链路图中的目标统一显示为 `host:port`。`443` 是 HTTPS 的标准端口，所以
`api.deepseek.com:443` 表示实际探测 `https://api.deepseek.com`。插件只做
DNS / TCP / TLS / HTTP HEAD 探测，不发送 Prompt、不携带凭据。

内置目标：

| id | 显示名 | 探测地址 |
|---|---|---|
| `deepseek` | DeepSeek | `https://api.deepseek.com:443` |
| `openai` | OpenAI | `https://api.openai.com:443` |
| `github` | GitHub | `https://github.com:443` |
| `npm-registry` | npm Registry | `https://registry.npmjs.org:443` |

DSH 配置了模型服务 Base URL 时会自动加入“当前模型服务”并作为默认目标。

自定义目标：编辑 `src/host/network/index.ts` 中的 `PUBLIC_TARGETS`，例如：

```ts
{ id: 'my-api', label: '我的 API', host: 'example.com', port: 443,
  url: 'https://example.com', kind: 'custom', display: 'example.com:443' },
```

修改后执行 `npm run build` 并重启 DSH。

## 安装

```powershell
dsh plugin --profile web add dsh-network-settings
```

重启 DSH Web profile 生效。插件声明了 `dsh.bundle`，`dsh plugin` 会自动把
它加入 profile bundle 列表。从 git 安装时请按 `dsh plugin` 的提示固定提交
并允许 `prepare` 构建脚本。

## 卸载

```powershell
dsh plugin --profile web remove dsh-network-settings
```

重启 DSH。快照与最近报告仍保留在 `$DSH_HOME/dsh-network-settings/`；
删除该目录可清理全部插件数据。

## 权限

| 操作 | 权限 |
|---|---|
| 打开页面、状态、一键检测 | 无 |
| WinINet / WinHTTP user / User 环境变量 / DSH 进程 | 当前用户，无 UAC |
| Machine 环境变量 / Machine WinHTTP | 执行该操作时才触发 UAC |
| 启动 Stopped WSL | 仅显式 `启动并检测` |

## 隐私

所有检测本地完成。不上传网络配置、IP、Hosts、代理地址或诊断报告；不收集
任何遥测。报告与快照自动脱敏：API key、token、cookie、Authorization、
password、URL/代理凭据均被移除或替换。

## 故障排查

- **没有“网络”页签**：确认插件已加入 profile bundle 列表，并重启 Web
  profile。
- **页面显示未检测**：点 `一键全面检测`；打开页面默认只读最近报告与静态
  配置，不访问公网。
- **WSL 显示未运行**：Stopped 发行版不会被偷偷启动；请使用显式启动并检测。
- **修复按钮不可用**：插件只应用高置信度且作用域明确的修复；展开
  `查看详情` 并复制诊断报告可进一步排查。
- **反复推荐“刷新 DNS”**：说明当前 DNS 问题不是缓存导致（常见于 VPN/代理 DNS 分流）。此时再次刷新不会有效；请复制 Agent 诊断报告继续排查。
- **机器级修复失败**：请在系统弹出 UAC 时允许该次操作后重试。

## License

MIT，见 [LICENSE](LICENSE)。
