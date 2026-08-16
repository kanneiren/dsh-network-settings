# Phase D — Hosts 单条删除 进展

状态：已完成并加载到当前 DSH。

## 已实现

- `src/host/repair/hosts.ts`
  - 解析 Hosts 非注释条目，输出 `ip / hostnames / line / raw`；
  - `hosts/entries`：只读列出；
  - `hosts/delete-preview`：单条删除预览（作用域说明 + `hosts:N: … → (删除)`）；
  - `hosts/delete`：删除前 `copyFile` 整个文件到 `.dsh-network-settings.bak`，再精确删除第 N 行；
  - 普通权限写入失败时走 elevated PowerShell（UAC）fallback；
  - `rollbackHostsSnapshot`：从整文件备份恢复。
- Snapshot scope：`windows.hosts`；`撤销上一次修改` 支持 Hosts。
- Client `RepairSection`：有条目时显示 `Hosts 条目修复` 卡片，每条独立 `删除此条目` 操作。

## 验证

- `npm run typecheck` 通过；unit **81/81**；UI **10/10**。
- 当前 DSH：`hosts/entries` 返回空（本机 Hosts 无条目，符合实际）；页面 E2E 通过。
- 未修改真实 Hosts。

## 说明

- 只支持单条删除；没有“清空 Hosts”操作。
- 删除前整文件备份，回滚恢复原文件。
