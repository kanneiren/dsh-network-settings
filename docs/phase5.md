# Phase 5 — Snapshot + Repair 进展

状态：已完成推荐修复、撤销上一次修改、配置历史与 scope 回滚的核心和 UI。

## 已实现

- `src/host/snapshot/store.ts`
  - 快照保存时计算 `reversible`：若脱敏改变原始值（如 URL 凭据），自动标记为不可自动回滚，避免恢复出“被抹掉凭据”的配置。
- `src/host/repair/index.ts`
  - `actionToConfigureRequest`：将 Phase 2 诊断动作映射为 Phase 4 scoped configure（当前支持 `clear-dsh-process-proxy`、`repair-env-scope-conflict`）；
  - `rollbackScope(scope)`：读取最新快照 → 校验 reversible → 通过 scoped apply 恢复 before；
  - `rollbackLatest()`：撤销最近一次修改。
- RPC：`repair/preview`、`repair/apply`、`repair/rollback`。
- Client `RepairSection`：
  - 诊断动作卡片 + `推荐修复`（支持的动作走 preview→Modal→apply，不支持的只提示）；
  - `撤销上一次修改`；
  - `配置历史`（scope/时间/原因）。

## 验证

- `npm run typecheck`：通过。
- `npm test`：66/66（新增 action 映射、DSH scope 回滚、无历史报错 3 例）。
- `npm run test:ui`：9/9（既有 UI 流程保持）。
- 真实 DSH E2E（隔离 profile）：页面显示
  - `网络急救`：`检查 DNS 服务器或刷新 DNS 缓存` + `推荐修复`；
  - `撤销上一次修改` + 历史记录 `配置修改: dsh.process clear`；
  - 配置卡片与详情区正常。
- 未对真实 Windows 系统设置执行写操作。

## 下一步（Phase 6）

高级网络急救：`ipconfig /flushdns`、`netsh winhttp reset proxy`、`netsh winsock reset`、`netsh int ip reset` 等逐项列出目的/风险/管理员/重启/可恢复性，独立执行，不打包无脑命令。
