# Phase C — WSL 未知环境网络配置 进展

状态：核心已实现，UI 已接入，当前 DSH 已加载。

## 已实现

- `src/host/wsl/sources.ts`
  - 对 Running 发行版只读扫描常见配置路径，输出 `file:line:raw`（raw 脱敏）；
  - 路径：`~/.bashrc`、`~/.bash_profile`、`~/.profile`、`~/.zshrc`、`~/.zprofile`、
    fish config、`/etc/environment`、`/etc/profile`、`/etc/profile.d/*.sh`、
    `~/.config/environment.d/*.conf`。
- `src/host/repair/wsl-proxy.ts`
  - `previewWslProxySource`：作用域说明 + `file:line → 删除` diff；
  - `applyWslProxySource`：先 `cp -p` 备份 → Python 校验行内容后只删该行；
  - `rollbackWslSnapshot`：从 `.dsh-network-settings.bak` 恢复。
- `.wslconfig autoProxy` 独立操作：
  - `wsl-autoproxy-enable`：仅把 `.wslconfig` 的 `autoProxy=true`，改前快照，标记需重启 WSL；
  - 行级编辑保留其他配置；缺失时创建最小 `[wsl2]` 段。
- RPC：
  - `wsl/proxy-sources`、`wsl/proxy-preview`、`wsl/proxy-apply`；
  - `repair/catalog` 增加 `wsl-autoproxy-enable`。
- UI `RepairSection`：
  - 有命中时显示 `WSL 文件级修复` 卡片，每个来源独立 `删除此行` 操作；
  - `全部修复操作` 目录包含 autoProxy opt-in。

## 验证

- `npm run typecheck` 通过；unit **78/78**；UI **10/10**。
- 当前 DSH：
  - 页面正常；
  - `wsl/proxy-sources`（Ubuntu-24.04）返回 `sources: []`（当前无 shell 文件残留，符合预期）；
  - `wsl-autoproxy-enable` preview 返回只修改 `.wslconfig` autoProxy 的作用域说明。
- 未对真实 `.wslconfig` 或发行版文件执行任何写入。

## 下一步

Phase D：Hosts 单条删除（整文件备份 + 单行 diff），并补 UI。
