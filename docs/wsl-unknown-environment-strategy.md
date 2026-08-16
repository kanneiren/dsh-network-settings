# WSL 未知环境网络配置策略

问题：WSL 里可能不是标准 Ubuntu，而是一个我们完全不认识的环境
（自定义 rootfs、NixOS、fish 用户、容器环境、只读系统等）。如何在
“发行版无关”前提下兼顾这些环境的代理配置？

## 结论

- **检测来源：必要且可行**，应作为 WSL 修复的前置能力。
- **有限白名单行级编辑：必要且可行**，覆盖绝大多数常见 shell 配置。
- **Windows 侧 autoProxy 权威注入：非常值得做**，是最发行版无关的修复路径。
- **drop-in 覆盖文件：可行，作为中间选项。**
- **自动修改未知发行版的专属网络管理配置：不必要、也不可行，应明确不做。**

## 策略

### 1. Source attribution（只读，必要）

对每个 Running 发行版：

1. 读取默认用户与 shell：`getent passwd`、`$SHELL`。
2. 能力探测常见配置路径是否存在：

```text
~/.bashrc  ~/.bash_profile  ~/.profile  ~/.zshrc  ~/.zprofile
~/.config/fish/config.fish  ~/.config/fish/conf.d/*.fish
/etc/environment  /etc/profile  /etc/profile.d/*.sh
~/.config/environment.d/*.conf
```

3. 对包含 `HTTP_PROXY / HTTPS_PROXY / ALL_PROXY / NO_PROXY` 的文件，输出
   `path:line:raw`，raw 经脱敏。
4. 识别来源为 `wsl-autoProxy`（`/init` 注入）还是 `shell-rc` / `etc`。

这样即使环境未知，也能告诉用户“代理来自哪个文件第几行”。

### 2. 有限白名单行级编辑（P1，可自动）

只编辑满足以下全部条件的文件：

- 命中固定白名单模式（上述 shell rc、`/etc/environment`、`/etc/profile.d/*.sh`）；
- 行内容精确匹配当前诊断出的失效 endpoint；
- 改前写 `.dsh-network-settings.bak`；
- 只删除/替换命中的行，不动其他内容；
- 文件不可写 / 只读系统 / 无权限 → `permission-required`，绝不用 root 强改。

白名单之外的文件：**不编辑**，只显示文件、行号和可复制的修复命令。

### 3. 发行版无关的 drop-in（可选增强）

对于“不想改用户 rc”或 fish / 特殊 shell 的情况，提供：

```text
/etc/profile.d/dsh-network-settings.sh
```

或 fish：

```text
/etc/fish/conf.d/dsh-network-settings.fish
```

创建前检查目录是否存在、是否可写；写前备份；提供卸载。这样绝大多数
POSIX login shell 都会加载，且不依赖发行版身份。

### 4. Windows 侧 autoProxy（高价值，最不依赖发行版内部）

如果 `.wslconfig` 中 `autoProxy=false`，而 Windows 代理当前可用：

- 提供 opt-in 操作：修改 `.wslconfig` 的 `autoProxy=true`；
- 改前快照 `.wslconfig`；
- 明确提示需要 `wsl --shutdown` / 重启 WSL 生效；
- 生效后所有发行版由 WSL 统一注入 Windows 代理，不碰任何发行版内部文件。

这是“兼顾未知环境”的最强手段，因为注入发生在 WSL 层，而不是发行版层。

### 5. 不可变/未知发行版

- 只读报告 + 建议命令；
- 状态 `not-applicable` / `permission-required`；
- 不尝试识别 NixOS / OpenWrt / 容器专属网络管理。

## 必要性 / 可行性矩阵

| 能力 | 必要性 | 可行性 | 结论 |
|---|---|---|---|
| Source attribution | 高 | 高 | 做 |
| 白名单行级编辑 | 高 | 高 | 做 |
| profile.d / fish conf.d drop-in | 中 | 中 | 可选做 |
| autoProxy opt-in | 中高 | 高 | 做，但需用户确认重启 |
| 编辑未知发行版网络管理配置 | 低 | 低 | 不做 |

## 实施归属

- Source attribution + 白名单编辑 → 并入已计划的 Phase C（WSL 单文件修复）。
- autoProxy opt-in → 作为独立原子操作 `wsl.autoproxy-enable`，带 `.wslconfig` 快照与重启提示。
- drop-in → 后续按需求加入，不作为 v1 默认行为。
