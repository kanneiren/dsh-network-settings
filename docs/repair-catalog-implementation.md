# 修复原子目录实施记录（Phase A + B）

状态：已实施并在当前 DSH 验证。

## Phase A：原子目录

- `src/host/repair/catalog.ts`
  - 每个操作一个 id、一个 scope、一个执行目标（configure 或 advanced）；
  - 操作之间无包含关系；
  - `diagnosisActionOperations` 把诊断动作映射为 0..n 个独立候选操作。
- RPC：
  - `repair/catalog`；
  - `repair/recommended`（输入诊断 actions，返回每个 action 的独立候选操作）；
  - `repair/preview` / `repair/apply` 兼容旧 action 与新的 `operationId`。

## Phase B：推荐排序 + 独立候选 UI

- `src/client/RepairSection.tsx`
  - 每个诊断显示候选修复卡片（独立按钮）；
  - 无候选时明确显示“该问题暂无自动修复”；
  - `全部修复操作` 折叠目录；
  - preview Modal 显示作用域说明与字段级 diff；
  - 撤销/配置历史保留。
- `ConfigureSection` 改为**只读状态**，所有修改动作只出现在修复目录，避免同一操作在两处重复出现。

## 验证

- typecheck 通过；unit 73/73；UI 13/13。
- 当前 DSH 实际显示：
  - `DNS_FAILURE` 推荐独立候选：`刷新 DNS 解析缓存`；
  - `全部修复操作` 目录可展开；
  - 网络配置区无重复修改按钮。

## 下一步

Phase C：WSL 来源归因 + 白名单行级修复 + autoProxy opt-in。
