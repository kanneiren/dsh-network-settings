# Phase 2 — Deterministic Diagnosis 进展

状态：已完成并接入 Phase 1 只读检测结果。规则全部为纯函数，不调用 LLM，不发起额外网络请求。

## 已实现

- `src/host/diagnose/model.ts` — `Diagnosis / DiagnosisEvidence / DiagnosisAction / DiagnosisReport` 模型。
- `src/host/diagnose/rules.ts` — 9 条确定性规则与 `runDiagnosis` 排序/汇总：

| Code | 触发条件 |
|---|---|
| `PROXY_ENDPOINT_UNREACHABLE` | proxy configured + endpoint TCP probe failed |
| `PROXY_CONFIGURED_BUT_UNUSABLE` | proxy TCP healthy + 经代理 HTTP failed |
| `DNS_FAILURE` | DNS failed + 至少一个目标的 TCP healthy |
| `TLS_FAILURE` | TCP healthy + TLS failed |
| `STALE_DSH_PROXY_ENV` | DSH process 有代理变量，而 Windows User 未设置或值不同 |
| `ENV_SCOPE_CONFLICT` | Process/User/Machine 同名代理变量值冲突 |
| `WSL_PROXY_UNREACHABLE` | Windows 代理可用 + WSL→Windows Host healthy + WSL→代理 failed |
| `WSL_PROXY_LOOPBACK_UNREACHABLE` | 上一条 + 代理为 loopback + NAT 模式 |
| `WSL_AUTOPROXY_STALE` | WSL 继承代理变量，但 Windows 当前无可达的同 endpoint |
| `HOSTS_OVERRIDE` | Hosts 覆盖诊断目标域名，且该目标探测异常 |

每条诊断包含 `code / severity / confidence / scope / humanMessage / technicalMessage / evidence[] / actions[]`；普通文案与技术信息分层。

## 质量

- `npx tsc --noEmit` 通过。
- `npm test`：**56/56 通过**（新增 25 个诊断规则用例，覆盖每条规则的正/负/边界场景与排序汇总）。
- 本机真实 smoke：正确输出 `STALE_DSH_PROXY_ENV`（当前 WSL 进程继承 `http://127.0.0.1:7892`，Windows User 未设置），其余链路健康因此无其他诊断。

## 运行

```bash
npm test
npx tsc --noEmit
node --experimental-strip-types src/host/smoke.ts --diagnose-only
```

## 下一步（Phase 3）

Settings UI：注册 `settings.plugins.tab`（设置 → 插件 → 网络），页面包含状态总览、`一键全面检测`、`查看详情`；Client 只调用 Typed API Service，不直接执行系统命令。宿主 RPC 通道、包构建与本地安装验证也在此阶段完成。
