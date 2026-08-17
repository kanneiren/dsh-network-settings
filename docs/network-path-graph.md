# Network Path Graph + Configuration Drift

本文件记录 `dsh-network-settings` 双网络模型链路图与配置漂移检测的实现边界。

## 网络配置层级

```text
网络配置
├─ Windows 代理：Windows 用户代理（WinINet）/
│   当前 Windows 用户环境变量 / PAC
├─ DSH：运行环境 / DSH 代理配置 / 配置来源 / 进程环境
├─ WSL：当前 Distribution / 发行版环境变量 /
│   .wslconfig / /etc/wsl.conf / 其他发行版
└─ 高级网络：DNS / WinHTTP / 接口路由 / Hosts / 系统恢复
```

未检测时网络配置仍显示，但值标为“未知”；未知是否存在 WSL 时不显示
WSL 分组。修改入口按来源和风险选择：低风险按钮、Windows 原生设置、
配置位置打开/复制、高风险系统恢复显式确认。

## 状态机

```text
Standby（页面打开）      = 仅读 last-report.json 摘要；零系统命令、零网络探测
Loading（一键检测）      = 完整静态采集 + 当前目标 probe，可取消
Ready（检测完成）        = 摘要 + DSH NetworkPathGraph + 详情 + 修复
TargetSwitch（切换目标） = 复用内存中的静态事实，仅重跑当前目标 probe
```

- `NetworkPathGraph` 只在 `run` 成功后生成；`status` 只返回脱敏 `NetworkPathSummary`。
- 打开页面不会执行 PowerShell、wsl.exe 或任何网络 probe。

## 两个一级模型

```text
WINDOWS_NATIVE
  DSH → Windows → [Proxy] → Adapter → Gateway → Internet → Target

WSL_DISTRIBUTION
  DSH → Distribution → WSL Network(NAT/Mirrored/…) → Windows Host
       → [Proxy] → Adapter → Gateway → Internet → Target
```

- 本插件只展示当前 DSH 进程的实际网络路径，不再推断 Windows 浏览器路径。
- Distribution（Ubuntu-24.04）与 WSL Network（WSL 2 / NAT）是两个独立节点。
- NAT 只作为边语义，不画成服务器；Mirrored/Bridged/VirtioProxy 使用各自关系。
- DNS 只出现在侧支；代理配置 / Endpoint / Listener 是三个独立对象。

## Runtime 检测优先级

```text
win32                              → WINDOWS_NATIVE
linux + microsoft kernel + WSL_DISTRO_NAME → WSL_DISTRIBUTION（注册名以环境变量为准）
linux + microsoft kernel + 无 WSL_DISTRO_NAME + 容器 cgroup → UNSUPPORTED_RUNTIME
linux + 非 microsoft kernel + 无 WSL_DISTRO_NAME → UNSUPPORTED_RUNTIME
```

注册名绝不从 `/etc/os-release ID` 反推；`--import` 的自定义名会保留。

## 目标

内置目标：DeepSeek、OpenAI、GitHub、npm Registry；DSH 配置了模型服务
Base URL 时自动加入“当前模型服务”。自定义目标方法见 README 的“目标与 `:443` 后缀”一节。

## Configuration Drift 规则

原则：**配置不同 ≠ 配置错误**。

| Code | 触发 | 严重度 | 最小影响修复 |
|---|---|---|---|
| `DRIFT_DSH_PROXY_STALE` | DSH 代理端点失效/无监听 | error | clear DSH process proxy |
| `DRIFT_WSL_PROXY_STALE` | WSL DSH 可达 Windows Host，但代理端点不可达 | error | clear DSH process proxy → 或 WSL autoProxy |
| `DRIFT_WINHTTP_STALE` | WinHTTP 配置存在但无监听，DSH 链路健康 | warning | user scope 优先；machine 最后 |
| `DRIFT_DSH_ENV_SCOPE_DIFFERENT` | DSH env 与 Windows 作用域不同但健康 | info | 不修复 |
| `DRIFT_WSL_ENV_DIVERGENT` | Distribution env 与 DSH env 不同但健康 | info | 不修复 |

修复全部走既有 `Snapshot → Preview/Diff → 确认 → Apply → 重新检测 → Rollback` 流程，
不会为了“统一配置”修改仍然正常的网络层。

## 已知限制

- 不做抓包、WFP、浏览器注入、扩展、MITM、长期监听。
- PAC/SOCKS/HTTPS 代理第一版不执行解析，路径标 `UNKNOWN`。
- Gateway/ISP 段不伪造；未单独探测的节点显示 `?`。
- WSL interop 关闭或相关配置不可读时降级为 `UNKNOWN`，不猜测。
