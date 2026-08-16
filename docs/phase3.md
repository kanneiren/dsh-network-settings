# Phase 3 — Settings UI 进展

状态：已完成，并在真实 DSH Web 配置中通过 E2E 验证。

## 已实现

- 双面包骨架：`package.json`（`dsh.bundle` + `dsh.client`）、`cordis.patch.yml`、`build/client-bundle.ts`（tsdown + lightningcss CSS Modules）。
- Host half：`src/host/index.ts`
  - 注册 `/dsh-network-settings` Connection RPC 通道，authority `loopback`；
  - endpoints：`status`（最近报告快速路径）、`run`（只读检测 + 确定性诊断 + 原子缓存到 `$DSH_HOME/dsh-network-settings/last-report.json`）；
  - 全部平台命令仍在 Network Core 内执行。
- Client half：`src/client/`
  - `settings.plugins.tab`（id `network`，order 30）→ 设置 → 插件 → 网络；
  - `NetworkService` typed RPC wrapper + `useSyncExternalStore` snapshot；
  - `NetworkTab` 组件：状态总览、7 行状态、`一键全面检测`、取消、`复制诊断报告`、`查看详情` 渐进披露（诊断/Windows/WSL/代理/分层探测）；
  - CSS Modules 仅使用 `--dsw-alias-*` token；组件使用 DSH `Button/StateDot/DisclosureRow/Tooltip/writeClipboard`。
- 构建产物：`lib/index.js`（Host）+ `lib/client.js`（浏览器 bundle）。

## 验证

- `npm run typecheck`：通过（host + client 两个 project）。
- `npm test`：56/56 通过。
- `npm run test:ui`：7/7 通过（idle/loading/ready/error 状态、诊断展开、CSS token 静态断言）。
- **真实 DSH E2E**（复制 `web` profile 为 `networktest`，`dsh plugin --profile networktest add C:\dsh-network-settings`，端口 3091，Playwright + 本机 Chrome）：
  1. 设置 → 插件 → 网络 页面正常出现；
  2. Host RPC `/dsh-network-settings/status`、`/run` 返回 `ok:true`；
  3. 点击 `一键全面检测` → loading → 完成后显示：
     - `网络有问题`
     - Windows 正常（10 接口）
     - WSL 正常（docker-desktop、Ubuntu-24.04，Stopped 未启动）
     - 代理正常 `http://127.0.0.1:7892`
     - DNS 异常
     - 互联网正常
     - `诊断结果 查看详情 · 1`（`DNS_FAILURE`）
  4. 浏览器控制台无错误，截图存于 `.research/network-settings-*.png`。

## 本机 E2E 真实诊断

Windows 进程 DNS 解析失败但代理路径可用：`DNS_FAILURE`（DNS failed + 其他 TCP 路径 healthy）——与本机当前 BoostNet/Tailscale 多网络环境一致。

## 运行方式

```bash
npm run build
npm test
npm run test:ui
# 启动隔离测试 profile（不要动用户 web profile）
dsh plugin --profile networktest add C:\dsh-network-settings
dsh --profile networktest --port 3091
DSH_URL=http://127.0.0.1:3091 node tests/e2e/smoke.mjs
```

## 下一步（Phase 4）

安全配置：Windows Proxy / Environment / WSL / DSH scoped config。每个修改作用域明确、修改前 Snapshot、用户确认、可回滚；Machine 级操作仅在执行时触发 UAC。
