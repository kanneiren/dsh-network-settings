# DSH Network Settings — Phase 0 研究报告

- 研究日期：2026-08-16
- 研究目标：确认“在 DSH 设置中新增一级『网络』页面，并实现 Windows / WSL / DSH 网络检测、诊断、配置与恢复”的可行性和实现路径
- 研究结论：**可行**。第三方插件可注册独立 `settings.section`，无需修改 DSH 源码即可在设置左栏新增“网络”；Network Core 应以 Host 半边的只读检查器 + Probe Engine 实现，Settings UI 通过 DSH 官方 Connection RPC 通道调用，全程本地完成。

### Phase 0 最终确认（2026-08-16）

- ✅ 进入 Phase 1：只读 Network Core，零修改用户电脑。
- ✅ 自建 `/dsh-network-settings` RPC 通道 + `$DSH_HOME/dsh-network-settings/` 本地持久化。
- ✅ 支持基线 `@deepseek-ai/dsh >= 0.1.0-rc.6`。
- ✅ 许可证 MIT，npm 包名 `dsh-network-settings`。
- ⚠️ 导航图标：当前 DSH 无公共 API 可为第三方 `settings.section` 提供图标（外壳 `navIcon(id)` hardcode，未知 id 回退齿轮）。经确认，**v1 不注册一级 `settings.section`，改为注册 `settings.plugins.tab`，入口为“设置 → 插件 → 网络”**；这优先保证视觉原生。未来若 DSH 上游开放 section 图标扩展点，再升级回“设置 → 网络”一级栏位（本报告第 2 节保留两种接入代码）。

---

## 0. 研究材料与版本基准

| 材料 | 版本 / 位置 | 结论 |
|---|---|---|
| deepseek-harness 源码 | `master` @ `47f943859bef60e4160492346772ded9b24f765a`（2026-08-13 合并） | 用于核对最新源码 |
| 本机已安装 DSH | `@deepseek-ai/dsh@0.1.0-rc.6`（2026-08-14 安装） | 运行时实测对象；本报告 API 结论同时对照 rc.6 安装产物与 master 源码 |
| 本机 Windows | Windows 11 家庭中文版，Build `10.0.26100.4946` | 实测只读网络检查 |
| 本机 WSL | WSL `2.7.10.0`，内核 `6.18.33.2-2`；发行版 `Ubuntu-24.04`、`docker-desktop` | 实测 WSL 解析与探测 |
| 第三方插件案例 | `deepseek-harness-zh_pro@0.5.0`、`@dshthemes/ui@0.2.0`、`awesome-deepseek-harness` | 验证真实插件的打包、安装、设置页与 Theme 扩展方式 |
| Microsoft 官方文档 | WSL basic-commands / networking / wsl-config / troubleshooting；`netsh winhttp`；WinHTTP-WinINet；`ipconfig`；PowerShell `about_Environment_Variables` | 检测方案与权限模型依据 |

> 当前 npm 上的 rc.6 安装产物比 master 源码中的部分 package.json 版本（rc.5）更新，但本报告涉及的 API 面（`settings.section`、slots、Connection RPC、bundle 机制）在两者中一致。公开发布时目标基线建议写 **`@deepseek-ai/dsh >= 0.1.0-rc.6`**。

### 0.1 关键源码位置（已逐项阅读）

- `packages/client/README.md`、`packages/client/AGENTS.md` — client 架构与插件包规则
- `docs/user/develop/basic/publish.md` — bundle/profile 双 manifest、`dsh plugin` 安装流程
- `packages/client/ui-settings/src/client/contract/slots.ts` — `settings.section` 等 slot 契约
- `packages/client/ui-settings-general/src/client/SettingsRoot.tsx`、`src/client/index.ts` — 设置外壳、导航投影、section 注册示例
- `packages/client/ui-settings-models/src/client/ModelsSection.tsx`、`*.module.css` — 官方设置页结构与 token 用法
- `packages/client/ui-settings-plugins/src/client/index.ts` — `settings.section` + 子 tab slot 官方实现
- `packages/client/ui-agent-preset/src/client/index.ts` — Agent 预设 section 注册
- `packages/client/ui-theme/src/styles/design-platform.css`、`docs/web-styling.md` — token 体系与样式红线
- `packages/client/ui-primitives/src/` — Button/StateDot/DisclosureRow/Modal 等原子组件
- `packages/client/modules/src/index.ts` — `dsh.client` 浏览器 roster 扫描
- `packages/client/connection/src/rpc.ts`、`src/rpc-host.ts`、`src/client/rpc.ts` — 通用 RPC 通道
- `packages/host/apiproxy/src/api-proxy.ts` — `/api` settings 暴露 allowlist
- `apps/cli/src/plugin.ts`、`packages/boot/app-boot/src/profile.ts` — `dsh plugin` 与 profile 组成

---

## 1. DSH 总体架构（与本插件相关的部分）

DSH 是“一切皆插件”的 Cordis 微内核组合系统：

```text
profile ($DSH_HOME/profiles/<name>)
├─ package.json          # dependencies + dsh.profile.bundles（bundle 顺序）
├─ cordis.patch.yml      # 用户自己的 patch 层
└─ node_modules/         # pnpm 安装的树外插件

配置树 = 空根
  → 每个 bundle 的 cordis.patch.yml（按 bundles 顺序）
  → profile cordis.patch.yml
  → $DSH_HOME/cordis.patch.yml
  → --patch 覆盖层
```

关键机制（均从源码与官方文档确认）：

- **Loader 行**：`cordis.patch.yml` 中 `- insert: - { id, name: '<npm 包名>' }` 会挂载一个插件包。包默认导出 Node 半边插件（Host half）。
- **浏览器半边**：包的 `package.json#dsh.client` 声明 `{ platform: 'web', inject: [...] }`，`exports["./client"]` 指向浏览器 bundle；`dsh-client-modules` 的 Node half 扫描 Loader 条目并生成 `window.__DSH_BOOT__`，浏览器物化为插件。
- **bundle 安装**：包声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 后，`dsh plugin --profile web add <pkg>` 会把包加入 profile 的 `dsh.profile.bundles`，重启即挂载，无需手工改配置文件。这是公开发布的标准方式。
- **client 模块纯度**：浏览器 bundle 通过 `window.__ModuleLoader__.load({ id, factory })` 注册，`factory(require)` 内只允许 require 已在 client 图中的包；跨插件协作只能走 Cordis services 和 slots，不能运行时导入其他插件符号。
- **Host-Client 通信**：官方 `connection` 提供两类通道：
  1. `/api` 域（`IApiClient`：sessions、settings、llm、goals…），第三方不能向 `/api` 追加端点（shared interceptor 已被 api-gateway 占用）；
  2. **通用 RPC 通道**：Host 插件调用 `ctx.connection.rpc.handle(channel, handler, { authority: 'loopback' })`，浏览器调用 `ctx.connection.rpc.call(channel, endpoint, payload, signal)`。通道自带 RPC 信封、rpcId 关联、JSON 校验、AbortSignal 取消和 loopback/trusted-host 信任围栏。
- **settings 持久化的一个关键限制**：浏览器 `ctx.settingsScope` 只读/写 `settings.describe`/`settings.mutate` 暴露的 namespace；Host 侧 API proxy 有显式 allowlist（可配置模型 provider 的 `settingsNs` + 少量内置 namespace）。**第三方注册的 settings namespace 默认不会远程暴露**。现有插件要么接受“仅内存/local”，要么用 `llm.registerConfigurableProviders()` 的副作用挤进 allowlist（会让“模型”页多出一个伪 provider 行，我们不采用）。

### 1.1 本插件的接入方案（推荐）

单包双面插件：

```text
package.json:
  main → lib/index.js                 # Host half：Network Core + RPC 通道
  exports["./client"] → lib/client.js # Client half：设置页 + Typed API Service
  dsh.bundle.patch → cordis.patch.yml # 标准安装入口
  dsh.client: { platform: "web", inject: [...] }

cordis.patch.yml:
  - insert:
      - id: dsh-network-settings
        name: dsh-network-settings
```

- Host half 注册只读检查器、Probe Engine、Snapshot/Repair，并通过 `/dsh-network-settings` RPC 通道暴露 Typed API。
- Client half 注册 `settings.section`（id `network`），只调用 Typed Service，**组件不直接执行任何系统命令**。
- 插件持久化文件（快照、最近报告、可选插件配置）放在 `$DSH_HOME/dsh-network-settings/` 下，由 Host half 原子写入；不依赖“第三方 settings namespace 能否远程暴露”这一不稳定点。

---

## 2. “设置 → 网络”的实现方式（已源码验证）

> 最终接入决策见文首：v1 使用 `settings.plugins.tab`（设置 → 插件 → 网络）；本章同时记录一级 `settings.section` 方案，作为后续升级路径。

### 2.1 Settings 外壳如何工作

- `ui-settings`（设置领域底座）声明 slot：`settings.trigger` / `settings.header` / `settings.action` / `settings.close` / `settings.section` / `settings.plugins.tab` / `settings.onboarding` / `settings.general.item`。
- `ui-settings-general`（外壳）占用 `sidebar.settings`，把 `settings.section` ledger 投影为左栏导航。**外壳不写死任何 section 文案**，全部来自注册方。
- 当前注册顺序（源码确认）：`general` order 0、`models` order 10、`plugins` order 15、`agent-presets` order 20。**`network` 使用 order 25** 即可出现在“Agent 预设”之后，符合需求中的栏位顺序。
- 导航图标由外壳 `navIcon(id)` 内部 hardcode：`models`/`agent-presets`/`plugins` 有专属图标，其他 id 回退为设置齿轮。**第三方 section 无法通过公共 API 提供导航图标**。第一版接受齿轮回退；未来可向 DSH 上游建议“section 图标”扩展点（Phase 0 不修改外壳）。

### 2.2 官方接入代码模式（复制自 `ui-settings-plugins` / `ui-settings-models`）

```ts
const NS = 'settings.network'

export const inject = ['slots', 'locale', 'connection']

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-network-settings: locale')
  const t = ctx.locale.bind(NS)

  const service = createNetworkService(ctx.connection)   // Typed API Service
  const injected = () => ({ service, useSnapshot, t })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'network',
    order: 25,
    label: () => t('nav'),      // locale thunk，外壳在 locale revision 变化时重投影
    locale: NS,
    inject: injected,
  }, NetworkSection))
}
```

**v1 实际采用的 `settings.plugins.tab` 接入（无导航图标问题）：**

```ts
// 外壳由 ui-settings-plugins 拥有，注册方只提供 tab 内容与文案
ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
  name: 'settings.plugins.tab',
  id: 'network',
  order: 30,               // configurable=0、inventory=10 之后
  label: () => t('nav'),
  locale: NS,
  inject: injected,
}, NetworkTab))
```

结论：
1. 第三方插件 **可以**注册独立一级设置页（`settings.section`），且无需修改 `ui-settings`、`ui-settings-general`、`ui-sidebar` 源码；
2. 当前版本导航图标只能由外壳 hardcode，第三方 section 会回退齿轮；因此 **v1 采用 `settings.plugins.tab`**，入口为“设置 → 插件 → 网络”，视觉完全原生；
3. 当上游提供 section 图标扩展点后，只需把同一组件从 `settings.plugins.tab` 迁移到 `settings.section`（id `network`，order 25），Network Core 与组件无需改动；
4. 页标题“网络”等文案由本插件 locale 注册，外壳文案自动继承现有 DSH 文案体系。

---

## 3. UI 组件复用方案（官方页面实际使用清单）

从 `ui-settings-general`、`ui-settings-models`、`ui-settings-plugins`、`ui-agent-preset` 源码确认：

**官方设置外壳本身**使用：
- 原生 `<button>` + CSS Modules（触发按钮、导航 cell、关闭按钮）；
- primitives 图标：`IconSettingsOutline16` / `IconCloseOutline16` / `IconDataOutline16` / `IconAgentPresetOutline16` / `IconPersonalizationOutline16`；
- 外壳 CSS 只使用 `--dsw-alias-*` token 和 `--dsw-shadow-lv3`、`--dsw-mask-blur` 等主题变量。

**官方设置内容页**使用：
- primitives：`Button`、`Modal`、`Tooltip`、`Toast`、`StateDot`、`DisclosureRow`、`Pill`、`Input`、`Menu`、`RiskConfirmation`、`JsonTree`、`DiffBlock`、图标集；
- 布局：**DSH 没有通用 `Section` / `Row` / `Switch` / `Select` / `Alert` / `Badge` primitive**。官方页面用 CSS Modules + token 自行实现卡片、行、表单、告警文案；`select` 为原生元素配合 token 样式；
- 设置页设计语言（`ModelsSection.module.css` 注释原文）：14/22 body、12/18 caption、胶囊按钮 h36 r18 / 密集 h28 r14、32px 输入框、`border-l2` 细线、卡片 r12、内容列 `max-width: 720px`。

### 3.1 网络页组件映射

| 需求 UI | 使用 |
|---|---|
| 总体状态 `正常/警告/错误/未知` | `StateDot`（done/warning/error/ongoing）+ 可见文本（StateDot 是 aria-hidden，文本承担可访问名） |
| 状态行（Windows/WSL/代理/DNS…） | CSS Module 行 + `StateDot` + 文案 |
| `[一键全面检测]` | `Button variant="primary"` |
| `查看详情` 渐进披露 | `DisclosureRow`（或与官方一致的原生 `<details>`/button，二选一，以 DisclosureRow 优先） |
| 配置历史 / 推荐修复入口 | CSS Module 卡片行（参考 Models rowCard） |
| 修复确认 | `Modal` + `RiskConfirmation`（修改范围说明 + diff） |
| 操作完成/失败 | `Toast` |
| 作用域/术语解释 | `Tooltip` |
| 代理地址等输入 | `Input`；协议/作用域选择用原生 `<select>` + token 样式 |
| Snapshot diff | `DiffBlock` / `JsonTree` |
| 复制诊断报告 | `Button` + primitives `writeClipboard` |

---

## 4. UI Compatibility（专项结论）

1. **DSH 当前设置页面使用哪些基础组件？**
   - 壳层：原生按钮 + CSS Modules + primitives 图标 + `--dsw-*` token。
   - 内容层：`@deepseek-ai/dsh-client-ui-primitives` 的 Button/Pill/Input/Menu/Modal/Tooltip/Toast/StateDot/DisclosureRow/HoverCard/RiskConfirmation/JsonTree/DiffBlock 等，以及官方页面自己的 CSS Modules。
   - **没有**通用 Section/Row/Switch/Select/Alert/Badge primitive。

2. **`settings.section` 的官方接入方式是什么？**
   - `ctx.slots.inject('settings.section', () => ctx.slots.register({ name:'settings.section', id, order, label, locale, inject }, Component))`。
   - 外壳自动投影 ledger 成导航；`label` 可以是跟随 locale 的 thunk。

3. **插件怎样继承 DSH Theme？**
   - 全部颜色/背景/边框/状态色通过 `var(--dsw-alias-*)` 语义 token 引用；`ui-theme` 的 ThemeRuntime 把解析后的 inline token 写到 `body`，`ui-layout` 管理 `color-scheme` 与 `body[data-ds-dark-theme]`。
   - 只要插件 CSS 不写 literal color、不写自己的 dark/light selector，就会自动跟随默认明暗主题和第三方 Theme。

4. **哪些 CSS/组件不能自己定义？**
   - 自定义主题系统、accent、字体、全局字号、全局背景、设置页宽度、圆角/阴影体系、spacing scale、dark/light 逻辑；
   - 不能改 DSH 全局 CSS、不能覆盖 Theme Provider、不能用 Tailwind/第三方组件库；
   - 不能 `body`/`html`/`#root` 级全局覆盖、不能大量 hardcode `color:#xxx; background:#xxx; border-radius; font-family`。

5. **第三方 Theme/UI 美化插件通常通过什么层工作？**
   - `ctx.theme.register(ThemeDefinition)` 注册 alias token 覆盖层，或 `ctx.theme.overrideTokens(source, {light,dark})` 叠加局部覆盖；ThemeRuntime 以 seq 顺序把覆盖层作为 inline CSS variables 应用到 `body`。
   - UI 美化插件还可通过 slot 覆盖/追加组件。只要网络页使用相同 slots 和 primitives，外观会一并变化。

6. **怎样让本插件尽量自动兼容？**
   - 语义结构进 slots/primitives；样式只进本包 CSS Modules；
   - CSS 中只消费 `--dsw-alias-*` / `--dsw-shadow-*` / `--ds-font-family-code` / `--ds-transition-*` 等既有 token；
   - 不写 literal 颜色；不写暗色选择器；不覆盖全局元素；不设 `!important`；
   - 状态只表达 `healthy/warning/error/unknown/not-tested/not-applicable/permission-required`，视觉交给当前 Theme。

7. **是否可以做到零额外 UI Theme 配置？**
   - 可以。本插件不提供“网络页面主题”等任何 UI 配置；无独立 theme、无模式开关。

8. **网络页面是否可以只使用 DSH primitives？**
   - 功能上可以覆盖 MVP 所需控件（Button/StateDot/DisclosureRow/Modal/Tooltip/Toast/Input/Pill/DiffBlock）。但**官方设置页自身也不是只使用 primitives**：Section、卡片、行、告警文案由页面级 CSS Modules 组装。因此“只使用 primitives”不等于“不写 CSS”；正确做法是**复用 primitives + 模仿官方页面 CSS Modules 且只用 token**。

9. **如果某个网络 UI DSH 没有原生组件，最小扩展方案是什么？**
   - 在本包内新增 CSS Module class（如 `.rowCard`、`.notice`、`.summaryGrid`），严格沿用官方 Models/Plugins 页面的 14/22、12/18、胶囊按钮、`border-l2`、`--dsw-alias-*` 语言；不创建可复用组件库、不导出新组件、不进入全局样式。

---

## 5. 真实第三方插件研究

### 5.1 deepseek-harness-zh_pro（设置页 + 双面插件 + bundle 安装）
- package.json 同时声明 `dsh.bundle.patch` 与 `dsh.client`，`cordis.patch.yml` 插入自身 row；`dsh plugin add` 后自动加入 profile bundles。
- client 半边注册了独立 `settings.section`（id `dsh-zh-enhance`，order 50），说明第三方设置页在实践中可用。
- Host 半边注册 `ctx.settings` namespace，并发现浏览器远程读写受 `/api` 设置 allowlist 限制，采用 `llm.registerConfigurableProviders()` 副作用暴露（我们不采用该副作用）。

### 5.2 @dshthemes/ui（Theme 插件 + General row + 持久化）
- client-only 包，向 `settings.general.item` 注册主题选择行，并用 `ctx.theme.register()` 注册第三方 ThemeDefinition。
- 证明了 Theme 覆盖只通过 alias token 层生效，正常使用 slots 的插件会自动跟随。
- 其 `dsh-themes` 持久化 namespace 未出现在 `/api` allowlist 中，README 声明的持久化在当前 rc 版本下实际可能退化为 loopback/process-local——这是第三方 settings namespace 暴露限制的旁证。

### 5.3 生态现状
- `dsh plugin --profile web add "github:owner/repo#ref"` 是标准安装方式；npm 发布、tarball、git 安装均可。
- GitHub 存在 `dsh-plugin` topic 与 Awesome 列表；发布插件需要 README、许可证、明确安装/卸载说明。

---

## 6. Windows 检测方案

优先级：官方稳定 API → PowerShell Cmdlet → Windows CLI → 稳定配置文件 → Registry → 启发式。**检测阶段绝不执行修改性命令。**

### 6.1 网络接口 / IP / 路由 / DNS / DHCP

| 信息 | 方法（只读） | 备注 |
|---|---|---|
| 活动接口 | `Get-NetAdapter`（Status、InterfaceDescription、MacAddress、Virtual） | `Name` 可能本地化，类型识别用 `InterfaceDescription` 正则 |
| IPv4/IPv6/网关/DNS | `Get-NetIPConfiguration` | 输出对象，避免解析 `ipconfig` 文本 |
| 默认路由 | `Get-NetRoute -DestinationPrefix '0.0.0.0/0'` / IPv6 | 多默认路由一并展示 |
| DNS Server | `Get-DnsClientServerAddress` | ServerAddresses 数组 |
| DHCP | `Get-NetIPInterface` + 配置对象 | 只展示 |
| Internet connectivity | Windows 侧由 Probe Engine 实测（HTTP/HTTPS），不把 NCSI 当作唯一结论 | 单目标失败不等于断网 |

接口类型识别表（v1 只展示，不删除）：Wi-Fi、Ethernet、WSL、Hyper-V、Docker、VPN、Tailscale、VMware、VirtualBox、Radmin/其他。

实测本机为中文 Windows：`Get-NetAdapter.Name` 出现“以太网 2”“WLAN”等中文本地化名称，同时 `Get-NetIPConfiguration` 默认路由含 BoostNet 隧道与 Radmin VPN 等多条虚拟网络路径——证实**必须解析对象而不是本地化文本**，且接口归类必须接受多虚拟网卡并存。

### 6.2 Windows 用户代理（WinINet / Internet Settings）

读取 registry（用户级，无管理员）：

```text
HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings
  ProxyEnable / ProxyServer / ProxyOverride / AutoConfigURL / AutoDetect
```

字段建模：`Manual Proxy`、`ProxyEnable`、`ProxyServer`、`ProxyOverride`、`Auto Detect`、`PAC/AutoConfig URL`。不改二进制 `DefaultConnectionSettings` 盲写；修复时通过 PowerShell 设置 registry 文本值或写回快照值。

### 6.3 WinHTTP（必须与用户代理分层）

当前 Windows 11 官方 CLI 已支持高级代理 JSON 输出：

```text
netsh winhttp show advproxy setting-scope=machine
netsh winhttp show advproxy setting-scope=user
```

实测输出包含 JSON 对象：

```json
{
  "ProxyIsEnabled": true,
  "Proxy": "127.0.0.1:7892",
  "ProxyBypass": "...",
  "AutoConfigIsEnabled": false,
  "AutoconfigUrl": " ",
  "AutoDetect": false,
  "PerUserProxySettings": true
}
```

策略：
1. 优先 `netsh winhttp show advproxy setting-scope=machine|user`，从输出中提取 `{...}` JSON 块；
2. 同时调用 `netsh winhttp show proxy` 展示基础设置（Direct / Proxy / Auto Proxy 三层）；
3. 解析失败时回退 registry / 标记 `unknown`，不因本地化报错而失败；
4. 明确展示 machine 与 user 两个作用域，且与 WinINet 用户代理分开。

实测本机同时存在：WinINet `ProxyEnable=1, ProxyServer=127.0.0.1:7892`，而 `netsh winhttp show proxy` 显示 Direct、`show advproxy` 又显示 per-user proxy enabled——正是需求中“多层代理冲突/残留”的真实样本，必须三层同屏。

### 6.4 环境变量

用 .NET API，不解析 `set` 输出：

```powershell
[Environment]::GetEnvironmentVariable(name, 'Process' | 'User' | 'Machine')
```

检查全部：`HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY` 及小写四种。UI 至少区分 Process / User / Machine 三列。

**DSH Process 环境 = Host half 自己的 `process.env`**：插件运行在 DSH Node 进程内，这是“DSH 实际继承环境”的最准确来源，无需跨进程读取其他进程环境块。显示时与 Windows User/Machine 并排，以暴露“User 未设置但 DSH 继承了旧值”的情况。

### 6.5 Proxy Endpoint

从 WinINet/WinHTTP/环境变量中提取出 endpoint 列表，每个 endpoint 建模：

```ts
interface ProxyEndpoint {
  source: 'wininet.user' | 'winhttp.machine' | 'winhttp.user' | 'env.process' | 'env.user' | 'env.machine' | 'wsl'
  url: string                    // 只保留 host/port/protocol，凭据立即剥离
  host: string
  port: number
  protocol?: 'http' | 'socks' | 'unknown'
  configured: boolean
  reachable?: boolean            // Windows TCP/代理协议探测
  listener?: { pid: number; processName: string }  // Get-NetTCPConnection + Get-Process
  usable?: boolean               // 通过该代理实际访问 Internet
}
```

区分 `configured / reachable / usable` 三态：
- configured：配置中存在；
- reachable：Windows 上 TCP 可连接（或 SOCKS/HTTP CONNECT 可握手）；
- usable：通过该代理能完成对至少一个目标的 HTTPS 请求。

绝不根据 endpoint 进程名绑定具体代理软件；进程名只作展示。

### 6.6 Hosts

读取 `%SystemRoot%\System32\drivers\etc\hosts`，默认只检查与当前诊断目标域名相关的覆盖；展示 `github.com → 127.0.0.1` 之类条目；提供“查看详情”，**不提供一键清空**。未来删除必须单条 + 备份。

### 6.7 监听端口/进程

`Get-NetTCPConnection -State Listen` 联合 `Get-Process`，用于 proxy endpoint 的 owningProcess 和基本监听信息；仅展示，不做连接级抓包。

---

## 7. WSL Distribution-agnostic 检测方案

### 7.1 Discovery（不启动任何 Stopped 发行版）

命令（官方文档确认）：
```text
wsl.exe --list --verbose
wsl.exe --list --running
wsl.exe --list --quiet
wsl.exe --status
wsl.exe --version
```

解析要点（已实测）：
- `wsl.exe --list*` / `--status` / `--version` 输出是 **UTF-16LE + CRLF**，Header 可本地化（本机中文“名称/状态/版本”），发行版名可含空格，默认发行版前有 `*`；
- 解析器统一 `iconv(UTF-16LE) → 去 BOM/NUL → 按行解析`；名称列表优先 `--list --quiet`，运行状态用 `--list --running` 的名称集合判断，版本号从 `--list --verbose` 行尾数字解析；Header 不参与解析；
- 名称含空格/Unicode 时**按整行截取**，绝不按空格切名称；
- 注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss` 的 `DistributionName/Version/DefaultUid/Flags` 作为 cross-check 与回退；
- 无 WSL 时返回 `{ wslAvailable: false, distributions: [] }`，页面显示“未安装/未检测到 WSL”。

内部统一模型（禁止 UbuntuSettings/DebianSettings 这类具体发行版类）：

```ts
interface WslDistribution {
  name: string                 // 实际注册名，原样显示
  state: 'running' | 'stopped' | 'unknown'
  wslVersion?: 1 | 2
  default?: boolean
  osMetadata?: { prettyName?; id?; versionId? }   // 仅 UI 展示
  capabilities: WslCapabilities
  network?: WslNetworkInspection
  dns?: ProbeCheck
  proxy?: WslProxyInspection
  environment?: Record<string, string | undefined>
}
```

### 7.2 能力检测优先于发行版检测

对 **Running** 发行版执行只读 sh 脚本（`wsl.exe -d <name> -- /bin/sh -c '...'`，不使用 bash 假设）。检测是否存在：

```text
/proc  /etc/os-release  /etc/resolv.conf  /etc/wsl.conf
ip  getent  curl  wget  python3  python  cat  sh
```

- `/etc/os-release` 仅取展示名，**不进入核心检测分支**；
- Probe 方法按能力降级：DNS `getent hosts` → python `socket.getaddrinfo` → `curl` 解析阶段；TCP `python socket` → `curl --connect-timeout` → `wget --timeout`；
- Interop disabled / 命令缺失 / 超时 → 单项 `unknown` 或 `not-applicable`，不拖垮页面。

### 7.3 `.wslconfig`（Windows 全局）与 `/etc/wsl.conf`（每发行版）严格分开

`.wslconfig` 解析器支持：
- section `[wsl2]` 与 `[experimental]`；
- `networkingMode`：当前官方值为 `none | nat | bridged(deprecated) | mirrored | virtioproxy`，缺省 NAT；未知值按 NAT 语义处理并标记 `unknown`；
- `dnsTunneling`（默认 true）、`autoProxy`（默认 true，官方文档说明“enforces WSL to use Windows HTTP proxy information”）、`dnsProxy`、`localhostForwarding`、`firewall`、`ignoredPorts`、`hostAddressLoopback`、`initialAutoProxyTimeout`；
- 解析成纯数据，不猜能力；结合 WSL `--version` 与 Windows Build 标注“该版本是否支持”而不是 hardcode 旧知识。

`/etc/wsl.conf` 只读检测 `[network] generateResolvConf/generateHosts`、`[boot] systemd`、`[interop] enabled` 等，归属于**该发行版**详情，绝不与 `.wslconfig` 混排。

### 7.4 Windows Host 地址动态判定（不 hardcode）

候选计算（按置信度排序）：
1. `.wslconfig networkingMode=mirrored` 且 WSL2 → `127.0.0.1`（官方文档：mirrored 下 localhost 互通；`::1` 不支持）；
2. WSL1 → Windows 侧 localhost 语义，候选 `127.0.0.1`；
3. NAT：发行版内 `ip route show default` 的网关（官方推荐），或 `cat /etc/resolv.conf` nameserver（dnsProxy 开启时的 NAT 网关）作为低置信度候选；
4. `virtioproxy`/未知模式：同时探测候选地址（网关、resolv.conf nameserver、127.0.0.1），以实际 TCP 探测成功者为准，并在详情中标注探测来源与置信度。

### 7.5 每个 Running WSL 的检测矩阵

```text
Distribution → Windows Host       (TCP 到动态判定的 host 地址/常用端口)
Distribution → DNS                (解析 github.com / npm registry / 模型域名)
Distribution → Internet Direct    (curl/wget/python 直连)
Distribution → Windows Proxy      (TCP 到 proxy endpoint)
Distribution → Windows Proxy → Internet  (经代理完成 HTTPS)
```

Stopped 发行版：只显示 `未运行`；完整检测按钮为 **`启动并检测`**，只有用户点击才执行 `wsl.exe -d <name> -- ...`（启动发行版属于用户主动授权的修改性动作，在 UI 与权限模型中单独说明）。

---

## 8. Probe Engine 设计

### 8.1 统一状态

```ts
type NetworkStatus =
  | 'healthy' | 'warning' | 'error' | 'unknown'
  | 'not-tested' | 'not-applicable' | 'permission-required'

interface ProbeCheck {
  status: NetworkStatus
  latencyMs?: number
  errorCode?: string
  humanMessage: string
  technicalMessage?: string
  source?: string       // 例如 'powershell:Get-NetAdapter' | 'wsl:/bin/sh:getent' | 'node:dns'
  timestamp: string
  details?: JsonObject
}
```

### 8.2 路径与分层

- 路径显式支持 `DIRECT` / `PROXY` / `SYSTEM` 三类；Windows 至少分别出“直连 Internet”和“通过 Proxy Internet”两个结论。
- 每个网络目标按 `DNS → TCP → TLS → HTTP/HTTPS` 四层探测；一层失败时后续层标记 `not-tested`，错误码保留本层原因，不折叠成“网络连接失败”。
- 默认目标（MVP）：`github.com`、`registry.npmjs.org`、当前模型服务（如可解析出 endpoint）。任一目标失败只降级该目标，**绝不**由单站失败推出“整个互联网断网”。

### 8.3 并发、超时、取消

- 所有外部操作有 timeout（单层默认 3–5s，HTTP 默认 8s，总任务默认 30–45s）；
- 独立 probe 并发执行，但有上限（例如 6）避免刷爆 DNS/连接；
- RPC 层传入 `AbortSignal`，Host 侧 `AbortSignal.any([signal, timeout])` 贯穿子进程与 socket；取消后已启动的 PowerShell/wsl 子进程终止；
- 单 probe 异常被捕获为结构化 `error` 结果，整体报告永远返回，页面不崩溃。

### 8.4 进入页面不自动全量检测

- 页面打开时只显示：静态配置 + 最近一次持久化报告（`$DSH_HOME/dsh-network-settings/last-report.json`）；
- `一键全面检测` 是唯一全量 Probe 入口；
- “启动并检测”是唯一会启动 Stopped WSL 的入口。

---

## 9. Deterministic Diagnosis 设计

规则引擎为纯函数，输入结构化 Probe 结果，输出：

```ts
interface Diagnosis {
  code: string
  severity: 'error' | 'warning' | 'info'
  confidence: number          // 0..1
  scope: 'windows' | 'wsl' | 'proxy' | 'dns' | 'tls' | 'model-service' | 'dsh'
  humanMessage: string        // 默认 UI 文案，自然语言
  technicalMessage: string    // 查看详情后展示
  evidence: ProbeEvidence[]
  actions: RepairAction[]     // 可选修复建议
}
```

首批规则（全部确定性，无 LLM）：

| Code | 规则 |
|---|---|
| `PROXY_ENDPOINT_UNREACHABLE` | proxy configured + endpoint TCP/CONNECT 失败 |
| `PROXY_CONFIGURED_BUT_UNUSABLE` | endpoint reachable + 经代理访问目标失败 |
| `DNS_FAILURE` | DNS 失败 + 按 IP 的 TCP 成功 |
| `TLS_FAILURE` | TCP 成功 + TLS 握手失败 |
| `STALE_DSH_PROXY_ENV` | DSH Process 存在 proxy 变量 + Windows 当前 User 未设置/值不同 |
| `WSL_PROXY_UNREACHABLE` | Windows 代理可用 + WSL→Windows Host 可用 + WSL→代理失败 |
| `WSL_PROXY_LOOPBACK_UNREACHABLE` | WSL 代理地址为 loopback + NAT 模式 + WSL→代理失败（提示 127.0.0.1 在 NAT 下不是 Windows） |
| `ENV_SCOPE_CONFLICT` | Process/User/Machine 同名变量值互相冲突 |
| `HOSTS_OVERRIDE` | hosts 中存在诊断目标域名覆盖，且解析结果与覆盖一致 |
| `WSL_AUTOPROXY_STALE` | WSL 环境继承代理 + Windows 代理已关闭/不可达 |

普通文案与技术信息严格分层：
- 默认显示 `WSL 无法使用当前代理`；
- `查看详情` 后显示 `Diagnostic Code: WSL_PROXY_UNREACHABLE`、Distribution、Network mode、Proxy、TCP 结果等原文。

---

## 10. Snapshot / Repair / 权限模型

### 10.1 Snapshot（修改前强制）

```ts
interface SnapshotRecord {
  id: string
  timestamp: string
  reason: string               // 例如 '推荐修复: 清除 DSH Process HTTPS_PROXY'
  scope: RepairScope           // 见下
  before: NetworkConfigPatch
  after?: NetworkConfigPatch
  reversible: boolean
}
```

- 存储：`$DSH_HOME/dsh-network-settings/snapshots/<id>.json`，原子写；
- 只保存必要网络配置；**绝不保存** API Key / password / cookie / token / authorization / URL credentials / Proxy credentials；
- 保存前统一过 `redact`（递归 key 匹配 + URL userinfo 剥离）。

RepairScope（配置页面与修复都必须显示作用域）：
```text
windows.wininet.user      Windows 用户代理（当前用户）
windows.winhttp.user       WinHTTP user 高级代理
windows.winhttp.machine    WinHTTP machine 高级代理
windows.env.user           用户环境变量
windows.env.machine        机器环境变量（需 UAC）
wsl.<distro>               <实际发行版名>（保守策略）
dsh.process                仅当前 DSH 进程（本次运行）
```

### 10.2 恢复的第一含义 = 回滚

- 不做“猜测 Windows 默认状态”式恢复；
- 第一优先级：`Snapshot → 修改 → Rollback`；UI 提供 **撤销上一次修改**；
- 每次修复前展示修改范围 diff（程序员可见），普通用户只看到“只会修改 X，不会修改 Y”的自然语言。

### 10.3 权限模型

| 操作 | 权限 |
|---|---|
| 全部检测/读取 | 普通用户，不申请管理员，不触发 UAC |
| WinINet 用户代理 / WinHTTP user / User 环境变量 | 当前用户，无 UAC |
| WinHTTP machine / Machine 环境变量 | 仅在用户执行该操作时启动 elevated PowerShell（触发 UAC） |
| 启动/检测 WSL 发行版 | 用户显式点击；以发行版默认用户执行，不假设 root |
| DSH 当前进程代理修复 | 修改 `process.env`（当前进程），不写 Windows 环境 |
| 网络页面打开 / 一键检测 | **绝不**申请管理员 |

### 10.4 推荐修复与高级重置

推荐修复是 targeted repair，例如：
- “DSH 继承了旧代理但 Windows 代理已关闭” → 清除/修改 `dsh.process` 作用域的 proxy 变量（或写入插件配置，下次启动应用）；
- “某 WSL 无法连接 Windows 代理” → 第一版优先给可复制的配置建议，只有高置信度且可回滚时才自动修改该发行版网络设置。

高级网络重置独立列出，每项单列目的/风险/管理员/重启/可恢复性：
- `ipconfig /flushdns`（低风险，通常无需管理员，可恢复性：缓存重建）
- `netsh winhttp reset proxy`（重置 WinHTTP 到 DIRECT）
- `netsh winsock reset`（管理员，需要重启）
- `netsh int ip reset`（管理员，需要重启）
不打包成一个“无脑命令”。

绝对禁止的默认修复（写入插件 invariant）：关闭 TLS 校验、`NODE_TLS_REJECT_UNAUTHORIZED=0`、关防火墙、删除 VPN/虚拟网卡、清空 Hosts、修改其他 Windows 用户、删除所有环境变量、关闭所有代理、重置所有网卡。

---

## 11. DSH 当前模型服务检测（不硬编码，不发 Prompt）

可用稳定 API（实测确认）：
- 浏览器：`connection.api.llm.providers({})` 返回 `{ provider, displayName, settingsNs, settingsPath, active }`；
- 浏览器：`settingsScope.bind({ namespace: 'agent-default-model' })` 可读当前默认 provider/model（该 namespace 在 `/api` 暴露集合内）；
- Host：`ctx.settings` 直接读 `llm-deepseek` / `llm-pi-ai` 配置；`baseURL` 若配置了会出现在 value 中，否则为空。

策略：
1. Host half 返回 `ModelServiceTarget[]`：active provider + displayName + 显式 baseURL（如有）+ 来源；
2. `baseURL` 缺失时优雅降级：状态 `unknown`/`not-tested`，说明“当前 provider 未显式配置 endpoint”，**不 hardcode** `api.deepseek.com` / `api.openai.com`；
3. 对已知 endpoint 只做 `DNS → TCP → TLS → HTTP reachability`；不发送 prompt、不消耗 Token；
4. `DEEPSEEK_BASE_URL` 等可信启动环境变量可作为附加候选显示（来自 DSH 自身文档的 resolver 逻辑），但标注来源。

---

## 12. 隐私与报告

- 所有检测在本地完成；不上传网络配置、IP、Hosts、代理地址、诊断报告；不收集网络遥测；MVP 无任何统计上报。
- `复制诊断报告` 生成结构化文本，包含 Runtime / Windows / DNS / Proxy / WinHTTP / Environment / WSL / DSH / Diagnosis 各段；
- 报告与快照统一经过脱敏器：删除或掩码 URL credentials、Proxy credentials、`Authorization`/`Proxy-Authorization`、API key、token、cookie、password 及同名变体；密钥只显示“已配置/未配置”。

---

## 13. 性能与错误隔离

- 页面首次打开：只读静态配置 + 最近报告；无全量公网访问；
- 全量检测才做完整 Probe；并发有上限、每操作有 timeout、全程可取消；
- 单项失败（例如 WSL 无法读取、WinHTTP 权限不足）返回 `error/unknown/permission-required`，页面其他区域照常显示；
- Host 命令执行统一封装：stdout/stderr 尺寸上限、超时 kill、locale 无关的 JSON 输出约定、错误转结构化结果。

---

## 14. Network Core 与 UI 分层（目标目录结构）

```text
dsh-network-settings/
├─ package.json                 # dsh.bundle + dsh.client + exports
├─ cordis.patch.yml             # - insert: id: dsh-network-settings
├─ src/
│  ├─ host/
│  │  ├─ index.ts               # Host half: RPC 通道注册、服务装配
│  │  ├─ runtime.ts             # platform/DSH home/权限/进程环境
│  │  ├─ windows/               # Get-NetAdapter、WinINet、WinHTTP、env、hosts、listeners
│  │  ├─ wsl/                   # discovery、.wslconfig、wsl.conf、capability、distro probes
│  │  ├─ proxy/                 # endpoint 解析/探测/分层
│  │  ├─ probe/                 # DNS/TCP/TLS/HTTP、DIRECT/PROXY/SYSTEM、并发/取消
│  │  ├─ diagnose/              # 纯函数规则引擎
│  │  ├─ configure/             # 作用域化修改
│  │  ├─ snapshot/              # 快照、diff、redact
│  │  ├─ repair/                # 推荐修复、回滚、高级重置
│  │  └─ report/                # 最近报告缓存、诊断报告生成
│  └─ client/
│     ├─ index.ts               # settings.section 注册 + Typed Service
│     ├─ service.ts             # connection.rpc 的 Typed API Service
│     ├─ NetworkSection.tsx
│     ├─ components/            # 状态卡、详情行、修复对话框
│     └─ *.module.css           # 仅 --dsw-* token
├─ tests/
│  ├─ unit/                     # parser、诊断规则、快照、redact
│  ├─ integration/              # A–J 矩阵 fixture
│  └─ ui/                       # 明暗主题、宽度、长名称、部分 error
├─ docs/
├─ README.md / README.zh-CN.md
├─ LICENSE / SECURITY.md / CONTRIBUTING.md
└─ .github/workflows/ci.yml
```

解耦原则：`src/host`（Network Core）不 import `src/client`；`src/client` 只依赖 `service.ts` 的 typed interface；未来 Network Guard 可复用 `src/host` 而无需改 UI。

---

## 15. MVP 与后续

### MVP（Phase 1–3 完成后可发布预览）

1. “设置 → 插件 → 网络”页面（v1 决策；后续可升级为“设置 → 网络”）；
2. 状态总览 + `一键全面检测` + `查看详情`；
3. Windows 只读检查（接口/IP/路由/DNS/WinINet/WinHTTP/环境变量/Hosts/监听）；
4. WSL discovery + Running 发行版只读检查 + 不启动 Stopped；
5. Probe Engine（DIRECT/PROXY/SYSTEM × DNS/TCP/TLS/HTTPS）；
6. Deterministic Diagnosis（首批 10 条规则）；
7. `复制诊断报告`（自动脱敏）；
8. 最近报告缓存；
9. 单元/UI 测试 + Windows 只读集成测试。

### 后续（Phase 4–7）

- 作用域化配置（Windows 代理/环境变量/WSL/DSH）；
- Snapshot + 撤销修改 + 配置历史；
- 推荐修复、高级网络重置；
- README 双语文档、CI、Release、Awesome DSH Plugins 提交。

### 明确不做（v1）

Network Guard、LLM 诊断、Clash/Mihomo/VPN/防火墙管理、常驻 daemon、定时轮询、抓包、实时拓扑大图、WFP/Winsock Hook。

---

## 16. 技术风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| rc 版本 API 漂移 | DSH 仍在 0.1.0-rc 迭代 | 锁定 `>=0.1.0-rc.6`；只用已公开且源码确认的 slots/RPC/bundle 契约；CI 多版本 smoke |
| 第三方 settings namespace 不远程暴露 | `/api` allowlist 限制 | 插件自建 RPC + `$DSH_HOME/dsh-network-settings` 持久化；后续若 DSH 开放注册点再迁移 |
| 导航图标 | 第三方 section 回退为齿轮 | 接受；文档说明；后续向上游提 icon slot |
| PowerShell/中文 Windows 编码 | `wsl.exe` UTF-16LE；PowerShell 输出编码本地化 | 固定编码协议：PS 脚本内 `[Console]::OutputEncoding=UTF8`，只输出 JSON；wsl 命令分离码流处理；单测覆盖中文/英文 locale fixture |
| WSL 名称含空格/Unicode | 文本切分易错 | `--list --quiet` 按整行解析 + `--running` 集合判状态 + Lxss registry 回退 |
| WSL 模式演进（mirrored/virtioproxy…） | 旧知识 hardcode 会误判 | 解析 .wslconfig 实际值；host 地址多候选实测；未知值标注 unknown |
| 修改系统配置不可逆 | Registry/环境变量误写 | 修改前快照、作用域 diff、RiskConfirmation、回滚优先；默认不做 Machine 级修改 |
| 第三方 UI Theme 不完整覆盖 token | 任何插件都可能让第三方主题局部不协调 | 我们只消费语义 token；不自行兜底颜色；在 README 说明兼容边界 |
| 代理/TLS 探测本身受限 | 某些代理需要认证或只允许特定流量 | 状态标记 `warning` 和 technicalMessage；不把失败直接归因为配置错误 |
| 性能/误触公网 | 全量检测访问多个公网目标 | 只在用户点击后运行；有超时、取消、并发上限 |
| 构建与发布复杂度 | 双面包、client bundle 纯度、git 安装 prepare 脚本 | 参考 @dshthemes/ui 的 tsdown 构建；npm 发布预构建产物；git 安装文档说明 prepare + allowBuilds |

---

## 17. 实施计划

| 阶段 | 内容 | 完成判据 |
|---|---|---|
| Phase 0（本阶段） | 研究、确认接入方案、数据模型、权限、MVP | 本报告确认 |
| Phase 1 | 只读 Network Core：Windows Inspect、Proxy Inspect、Environment Inspect、WSL Discovery/Inspect、Probe Engine | 所有检测可在 Host 侧独立运行，零修改；单元测试通过 |
| Phase 2 | Deterministic Diagnosis | 规则纯函数 + 单元测试；报告生成 |
| Phase 3 | Settings UI：状态、一键全面检测、查看详情 | 页面可跑通 read-only 流程；UI 测试通过 |
| Phase 4 | 安全配置：Windows Proxy / Environment / WSL / DSH scoped | 每处修改带作用域与确认 |
| Phase 5 | Snapshot + Repair：推荐修复、撤销修改、配置历史 | 快照/回滚测试通过 |
| Phase 6 | 高级网络急救 | 每操作独立风险评估 |
| Phase 7 | 公开发布：README 双语、LICENSE、SECURITY、CONTRIBUTING、CI、Release、Awesome 提交 | npm/仓库发布就绪 |

---

## 18. 测试矩阵

### 18.1 单元测试（必测）

- WSL list parser：UTF-16LE/CRLF、中文 Header、名称含空格、多发行版、默认 `*`、无 WSL、WSL1/2 混用；
- Proxy parser：`http://host:port`、无 scheme、IPv6 `[::1]:port`、多代理、凭据剥离、NO_PROXY 规则；
- IPv4/IPv6 地址与路由 parser；
- `.wslconfig` parser：`[wsl2]`/`[experimental]`、注释、大小写、`networkingMode` 新值、默认值；
- `/etc/wsl.conf` parser；
- Environment scope 合并与冲突判定；
- Diagnosis rules：每条规则最少 3 个用例；
- Snapshot：创建、diff、restore 计划、损坏文件处理；
- Secret redaction：URL credentials、key/token/cookie/authorization/password 变体、代理凭据。

### 18.2 集成矩阵（对应需求 53）

| # | 场景 | 期望 |
|---|---|---|
| A | Windows Direct OK / No Proxy / No WSL | Windows 正常，WSL not-applicable |
| B | Windows Proxy ON / Proxy OK | proxy configured+reachable+usable |
| C | Proxy configured / 软件已停 | PROXY_ENDPOINT_UNREACHABLE；建议清理或修复 |
| D | Windows Proxy OK + Running WSL + WSL Proxy failed | WSL_PROXY_UNREACHABLE；详情可见 NAT/host/proxy TCP failed |
| E | Windows Proxy OK + WSL mirrored + WSL Proxy OK | 全链路 healthy |
| F | 多发行版 A Running / B Running / C Stopped | Running 完整检测；Stopped 显示未运行，不启动 |
| G | DNS failure / TCP by IP OK | DNS_FAILURE |
| H | TCP OK / TLS failed | TLS_FAILURE |
| I | Windows User env 未设置 / DSH Process 有旧 HTTPS_PROXY | STALE_DSH_PROXY_ENV |
| J | Process/User/Machine env 冲突 | ENV_SCOPE_CONFLICT |

CI 建议：Linux runner 跑 unit + UI；Windows runner 跑只读 inspect + A/B/C/H 类网络 fixture；WSL 矩阵在带 WSL 的 Windows runner 或手动矩阵跑。

### 18.3 UI 测试

Light/Dark、DSH 默认主题、第三方 Theme（token override fixture）、窗口宽度、长发行版名、长 Proxy URL、多发行版、无 WSL、部分结果 error、loading、cancellation。另加静态断言：本包 CSS 不出现 literal 颜色、不出现 `body`/`html` 选择器、不出现暗色主题选择器。

---

## 19. Phase 0 确认结果

1. 导航图标：**v1 使用 `settings.plugins.tab`（设置 → 插件 → 网络）**，保留一级 section 升级路径。
2. 持久化与通信：**自建 `/dsh-network-settings` RPC + `$DSH_HOME/dsh-network-settings/`**。
3. 支持基线：**DSH >= 0.1.0-rc.6**。
4. 许可证与包名：**MIT + `dsh-network-settings`**。

已确认进入 Phase 1。
