# 整体回归（Phase 6 → Phase 7 之间）

日期：2026-08-16。应确认选择“先整体回归”，未进入 Phase 7。

## 回归范围

- 全量：`typecheck`、68 个单元测试、10 个 UI 测试、真实 DSH E2E。
- 功能走查：状态总览 → 一键全面检测 → 详情 → 推荐修复 → 撤销/历史 → 作用域配置 → 高级网络急救 → 模型服务降级。

## 回归发现并修复

1. **User 环境变量“清除全部代理变量”只清了 HTTPS_PROXY**：新增 `replaceEnvironmentScope`/`clearEnvironmentProxy`，Preview/Apply/Rollback 均按 8 个代理变量整体处理；`ConfigureRequest` 增加 `values` 支持回滚恢复整组值。
2. **DSH 模型服务从未接入**：新增 `src/host/dsh/model-services.ts`，从 Host `settings.describe` + `llm.listConfigurableProviders/listProviders` 解析 active provider 与显式 `baseURL`；无 endpoint 时优雅降级 `not-tested`，不 hardcode 公共域名。模型 endpoint 存在时进入 DNS/TCP/TLS/HTTP 分层探测。
3. **UI 小修**：模型服务行显示 active provider；修复按钮 disabled 表达式简化；移除未使用 icon import。

## 回归结果

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm test` | 70/70 |
| `npm run test:ui` | 10/10 |
| `npm run build` | 通过 |
| 真实 DSH E2E（隔离 profile） | 通过，浏览器无 console error |
| 本机页面 | Windows 正常（10 接口）、WSL 正常、代理正常、DNS 异常、互联网正常、DSH 模型服务（DeepSeek）未检测（endpoint 未显式配置，按设计降级） |

## 结论

可以进入 Phase 7（发布准备）。

## 第二轮 UI 回归（用户反馈）

- 诊断结果折叠行只显示问题数量，移除重复的“查看详情”文案。
- Windows 状态行详情从裸数字 `10` 改为 `10 个网络接口`，避免被误读为 Windows 10。
- 状态行由 grid 改为 flex + 主列 min-width:0，标签/详情/状态不再挤压；DSH 模型服务行“模型服务”不再竖排。
- 增加 560px 断点响应式规则；Playwright 实测 520 / 720 / 1000 宽度下 `document.body.scrollWidth` 均等于视口宽度，无横向溢出。

## 第三轮 UI 回归（用户反馈）

- “诊断结果”折叠行不再显示“1 个问题”，仅保留标题。
- 状态行图标改为与行内容垂直居中对齐。
- 网络配置区新增“WSL 全局网络（.wslconfig，只读）”卡片：显示 networkingMode / autoProxy / dnsTunneling，并说明 v1 不自动修改。

## 第四轮体验回归（用户反馈）

- 新打开网络页面不再显示上一次诊断结果；只有本次 `一键全面检测` 完成后才显示诊断与状态。
- `复制诊断报告` 从 raw JSON 改为 Markdown 结构化报告（结论 / 诊断 / Windows / 代理 / WSL / 分层探测），适合直接粘贴给 Agent。
- 修复推荐在候选操作上显示绿色“推荐”徽标；多候选时显示“建议执行顺序”和“第 N 步”。
- 移除重复的“高级网络重置”区域；高级操作统一从“全部修复操作”进入。

## 第五轮体验回归（用户反馈）

- 复制按钮改为“复制 Agent 诊断报告”。
- 推荐修复不再藏在“全部修复操作”里：推荐操作直接置顶在对应诊断下，绿色“推荐”徽标 + 可选“第 N 步”；其余非推荐操作折叠为“其它修复操作”。
- WSL 诊断报告与“网络配置”新增发行版内部网络事实（resolv.conf、默认路由、generateResolvConf/generateHosts、systemd），只读展示并进入报告。

## 第六轮体验回归（用户反馈）

- 状态行按语义分组：`环境与配置`（Windows 网络 / WSL 网络 / 代理配置）和
  `连通性`（DNS 解析 / 访问互联网 / DSH 模型服务）。
- “访问互联网”详情同时显示直连与代理两条路径结果，避免单个“互联网”标签误导。

## 第七轮（DNS 反复推荐问题）

- 高级操作执行后写入 `action-history.json`；
- `repair/recommended` 返回 24 小时内已执行的操作 id；
- UI 对已执行但诊断仍存在的操作不再重复推荐，改为提示“已执行过：X（仍异常，建议复制报告给 Agent）”。
