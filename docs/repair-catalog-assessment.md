# 原子修复目录评估

目标：把修复做成“独立、无包含关系、可 preview / apply / rollback”的原子操作目录，
并诚实评估每个操作的必要性。

## 结论摘要

- 目录化是必要的：它能同时满足“安全、可回滚、无包含关系、可推荐排序”。
- 现有能力已经覆盖 A1/A2/B1/B2/B3/C1/C2/C3 的大部分，应优先重构为目录并补齐 UI。
- WSL shell 文件级清理（D 系列）是提高“本地代理残留”覆盖的关键新增项，建议 P1 实现。
- Hosts 单条删除（E1）建议 P2，功能独立但优先级低于 WSL。
- 时间同步（C4）不建议作为自动修复，只保留“建议命令”。

## 必要性矩阵

| 优先级 | 操作 | 必要性判断 |
|---|---|---|
| P0 | 修复目录 + `repair/catalog` + 独立卡片 | 必要。没有目录就无法保证“无包含关系”和最小作用域 |
| P0 | A1 DSH 进程代理 | 已有；保留 |
| P0 | A2 User 环境变量整组清除/回滚 | 已有；保留 |
| P0 | A3 Machine 环境变量整组清除/回滚（UAC） | 已有底层能力，需补 UI |
| P0 | B1 WinINet 清除/回滚 | 已有；保留 |
| P0 | B2 WinHTTP user 清除/回滚 | 已有；保留 |
| P0 | B3 WinHTTP machine reset + 快照 | 已有（advanced），需要从高级区移到作用域配置/推荐候选 |
| P0 | C1 flushdns | 已有（advanced）；保留为独立操作 |
| P0 | C2 winsock reset / C3 ip reset | 已有（advanced）；保留为独立高风险操作 |
| P1 | D1–D5 WSL 单文件 proxy 行级删除 + `.bak` 回滚 | 新增。覆盖 WSL shell rc 残留，是“WSL 本地代理残留”场景的高价值项；只处理精确匹配行，不批量改文件 |
| P2 | E1 单条 Hosts 删除 + 整文件备份 | 新增。需求明确要求单条 + 备份；实际出现率低于代理残留，可作为独立小功能 |
| 不做 | “一键清理全部代理” | 会制造包含关系，违背目标 |
| 不做 | 自动切换 WSL networkingMode | 高风险，需用户显式重启；保留只读/建议 |
| 不做 | C4 自动时间同步 | 已超出网络配置 scope，只输出建议命令 |

## WSL 网络配置分层说明

WSL 里的 Ubuntu 确实有自己的 Linux 网络配置，但 WSL 场景下要分三层看：

1. **Windows 侧全局 `.wslconfig`**
   - `networkingMode`（NAT / mirrored / virtioproxy）
   - `dnsTunneling`、`autoProxy`、`localhostForwarding`、`firewall`
   - 决定 WSL2 轻量虚拟机的整体网络行为，对**所有发行版**生效。

2. **WSL 每发行版 `/etc/wsl.conf`**
   - `[network] generateResolvConf / generateHosts`
   - `[boot] systemd`
   - `[interop]`
   - 它是 WSL 特有的配置文件，不是传统 Linux 网络管理配置。

3. **Ubuntu 自己的网络配置**
   - `/etc/resolv.conf`（WSL 默认自动生成）
   - `/etc/hosts`
   - netplan（`/etc/netplan/*.yaml`）、systemd-networkd、NetworkManager 等
   - shell 配置中的代理变量：`~/.bashrc`、`~/.zshrc`、`~/.profile`、`/etc/environment`、`/etc/profile.d/*`

在 WSL2 中，IP、路由、NAT/mirrored 行为由 WSL 控制；Ubuntu 原生 NetworkManager /
netplan 通常不应接管 WSL 虚拟网卡，否则会和 WSL 冲突。因此本插件：

- `.wslconfig` 只读；
- `/etc/wsl.conf` 只读展示；
- Ubuntu 侧只修复“代理环境变量残留”（shell 文件、`/etc/environment`、`/etc/profile.d`），
  不改 netplan / systemd-networkd / NetworkManager。

## 建议实施顺序

1. Phase A：修复目录化（P0）。
2. Phase B：推荐排序 + UI 独立候选（P0）。
3. Phase C：D 系列 WSL 单文件行级修复（P1）。
4. Phase D：E1 Hosts 单条删除（P2，可与 C 并行）。
