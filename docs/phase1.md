# Phase 1 — 只读 Network Core 进展

状态：已完成第一轮可运行实现。所有命令均为只读；未实现配置、修复、诊断规则和 UI。

## 已实现

- 共享数据模型：`src/host/model.ts`（7 种网络状态、ProbeCheck、WslDistribution、ProxyEndpoint、环境作用域等）。
- WSL 解析：
  - `src/host/wsl/encoding.ts` — `wsl.exe --list*` UTF-16LE 解码；
  - `src/host/wsl/list.ts` — `--quiet`/`--running`/`--verbose` 组合解析 + Lxss registry 回退；
  - `src/host/wsl/wslconfig.ts` — `.wslconfig`/`/etc/wsl.conf` INI 解析、networkingMode/dnsTunneling/autoProxy 等；
  - `src/host/wsl/inspect.ts` — WSL 版本/状态/发行版发现，Running 发行版只读能力与网络事实（stdin 传 `/bin/sh`，不假设 bash）。
- Proxy/Environment：
  - `src/host/proxy/proxy-url.ts` — 代理 URL 解析、多端点、凭据立即剥离、IPv6；
  - `src/host/proxy/no-proxy.ts` — NO_PROXY 匹配；
  - `src/host/proxy/inspect.ts` — 汇总 WinINet/WinHTTP/Env/WSL 为统一 ProxyEndpoint[]。
- Windows 只读检查：
  - `src/host/runtime/command.ts` / `powershell.ts` — 超时/取消/输出上限的只读命令执行器；
  - `src/host/windows/inspect.ts` — 一个 PowerShell JSON 检查器（接口/IPv4/IPv6/网关/路由/DNS/DHCP、WinINet、WinHTTP advproxy、环境变量三作用域、Hosts、监听端口/进程）。
- Probe Engine：
  - `src/host/probe/net.ts` — DNS/TCP/TLS/HTTP(S)、HTTP CONNECT 隧道、经代理 HTTP；
  - `src/host/probe/probe.ts` — DIRECT/PROXY/SYSTEM 分层编排；
  - `src/host/probe/wsl.ts` — 发行版内 getent/python/curl/wget 能力降级探测。
- 脱敏：`src/host/redact.ts`（报告/快照共用）。
- 顶层入口：`src/host/inspect.ts`（静态检查 + 按需探测）、`src/host/smoke.ts`（JSON smoke）。

## 质量

- `npm run test`：31 个单元测试全部通过（WSL list 中文/UTF-16/空格名/默认标记、`.wslconfig` 新网络模式、代理解析、NO_PROXY、UTF-16 解码、发行版 probe 解析、接口分类、脱敏）。
- `npx tsc --noEmit`：通过。
- 本机真实 smoke（Windows 11 26100 + WSL 2.7.10 + mirrored + autoProxy）：
  - 正确识别 10 个 Windows 接口（Wi-Fi/Ethernet/VMware/VirtualBox/Hyper-V/Tailscale/VPN 等）；
  - 正确读取 WinINet/WinHTTP/环境变量三层代理，并关联监听进程 `BoostNetCore`；
  - 正确识别 `docker-desktop` Stopped、`Ubuntu-24.04` Running，**未启动 Stopped 发行版**；
  - 分层探测输出与本机实际一致：本开发环境 Windows/WSL 直连 TCP 失败、代理路径 healthy、WSL → Windows Host healthy。

## 运行方式

```bash
npm test
npx tsc --noEmit
# 全量只读检查（Windows + WSL + Probe，本机 WSL 约 10–30s）
node --experimental-strip-types src/host/smoke.ts
# 跳过 WSL / 跳过 Probe
node --experimental-strip-types src/host/smoke.ts --no-wsl
node --experimental-strip-types src/host/smoke.ts --no-probes
```

## 注意

- 在 WSL 开发壳中，直接 `wsl.exe -d <当前发行版>` 可能挂起；实现已自动经 `cmd.exe /c` 从 Windows 侧启动。生产 Host 是 Windows Node，直接走 `wsl.exe`。
- 本 WSL 开发壳有 `LD_PRELOAD=proxychains`，会劫持 Node 到 127.0.0.1:7892 的连接；本地 smoke 代理探测建议 `env -u LD_PRELOAD node ...`。生产 Windows Node 无此问题。
- DSH 进程环境 = Host half 的 `process.env`；目前 smoke 从 WSL Node 运行，因此 `dsh` scope 显示的是 WSL 环境。接入 DSH Host 后会显示真实 DSH 进程环境。

## 下一步（Phase 2）

在 `src/host/diagnose/` 实现确定性规则引擎，消费 `ProbeCheck[]`/`WindowsInspection`/`WslInspection`，输出 Diagnosis（code/severity/confidence/scope/humanMessage/technicalMessage/evidence/actions），并补充规则单测。
