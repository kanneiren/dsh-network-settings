# Phase 6 — 高级网络急救 进展

状态：已完成。每项操作独立展示与执行，不打包无脑命令；未在真实机器执行任何高级重置。

## 已实现

- `src/host/repair/advanced.ts`：4 项官方操作目录
  | id | 命令 | 风险 | 管理员 | 重启 | 可恢复 |
  |---|---|---|---|---|---|
  | `flush-dns` | `ipconfig /flushdns` | low | 否 | 否 | 是 |
  | `reset-winhttp-proxy` | `netsh winhttp reset proxy` | medium | 是 | 否 | 是（执行前创建 WinHTTP machine 快照） |
  | `reset-winsock` | `netsh winsock reset` | high | 是 | 是 | 否 |
  | `reset-ip` | `netsh int ip reset` | high | 是 | 是 | 否 |

- `reset-winhttp-proxy` 执行前自动快照 `windows.winhttp.machine` 并在执行后回填 after。
- RPC：`advanced/list`、`advanced/run`。
- Client `AdvancedSection`：每项显示目的/风险/管理员/重启/可恢复性；确认 Modal 后单独执行；执行后自动重新检测。

## 验证

- `npm run typecheck`：通过。
- `npm test`：68/68（新增目录元数据 2 例）。
- `npm run test:ui`：10/10（新增高级急救确认执行流程）。
- 真实 DSH E2E：页面完整渲染 4 个高级操作及风险说明；RPC `advanced/list` 返回正确目录；`advanced/run` 对未知 id 返回结构化错误。
- 未在真实机器执行任何高级重置。

## 下一步（Phase 7）

公开发布：README.md / README.zh-CN.md / LICENSE / SECURITY.md / CONTRIBUTING.md、CI、npm 打包验证、Release、Awesome DSH Plugins 提交准备。
