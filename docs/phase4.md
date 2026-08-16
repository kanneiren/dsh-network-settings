# Phase 4 — 安全配置 进展

状态：Network Core 与 UI 已完成作用域化配置骨架；真实机器仅执行了 DSH 作用域的 no-op 写入与 preview，未修改 Windows 系统设置。

## 已实现

- Snapshot：`src/host/snapshot/store.ts` / `diff.ts`
  - 修改前强制创建快照（timestamp/reason/scope/before/after/reversible）；
  - before/after 自动脱敏；原子写入；损坏文件不影响配置；
  - 修改完成后回填 after，供历史与回滚使用。
- 作用域化配置：`src/host/configure/`
  - `windows.wininet`：WinINet 用户代理设置/清除（HKCU）；
  - `windows.winhttp.user`：WinHTTP 用户高级代理（`netsh winhttp set advproxy setting-scope=user`）；
  - `windows.env.user`：User 环境变量 set/unset（无 UAC）；
  - `windows.env.machine`：Machine 环境变量 set/unset（按需 elevated PowerShell/UAC）；
  - `dsh.process`：仅当前 DSH 进程代理环境变量 + `$DSH_HOME/dsh-network-settings/dsh-config.json` 持久化；
  - 每个 scope 有明确 `scopeDescription`（“只会修改 X，不会修改 Y”）。
- RPC：`configure/preview`（before/after/diff/scope 说明）、`configure/apply`（快照→修改→回填 after）、`snapshot/list`。
- UI：NetworkTab 新增 `网络配置` 卡片区；每个作用域独立按钮，点击后显示 Modal 确认（范围说明 + field-level diff），确认才执行；WSL 第一版只读说明。

## 验证

- `npm run typecheck`：通过。
- `npm test`：63/63（新增 configure preview 3 例；diff/redacted snapshot 持久化）。
- `npm run test:ui`：9/9（新增 configure 预览/确认流程测试）。
- 真实 DSH（隔离 `networktest` profile）：
  - 页面渲染 4 个配置卡片 + WSL 只读说明；
  - `configure/preview`（WinINet clear）返回 before/after 与 `$.enabled`、`$.proxyServer` 等字段级 diff；
  - `configure/apply`（DSH clear，当前无代理，no-op）创建快照 `1786882135999-fc9d39`，`snapshot/list` 可读；
  - 未执行任何 Windows 系统写操作。

## 运行

```bash
npm run build && npm test && npm run test:ui
# 隔离 profile E2E 同 Phase 3
```

## 下一步（Phase 5）

Snapshot + Repair：`推荐修复`、`撤销上一次修改`、`配置历史`；把 Phase 2 的 `actions[]` 与 Phase 4 的 scoped apply 连接起来，并实现按 scope 的回滚。
