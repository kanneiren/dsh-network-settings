# Diagnostics

## How a result is produced

```text
static facts
      +
layered probes for the current target
      ↓
DSH NetworkPathGraph
      ↓
first failing edge
      ↓
Drift rules + legacy deterministic rules
      ↓
merged diagnosis report
```

No LLM is involved. Every diagnostic is deterministic.

## Layered probe mapping

```text
DNS   failure → DNS side branch failed
TCP   failure → first failing edge at the target/proxy connection
TLS   failure → first failing edge after a healthy TCP connection
HTTP  failure → first failing edge at the target connection
```

Repeated stability probes expose:

```text
success count / attempt count
average / min / max latency
```

## First failure

The graph finds the first edge with `error` or `warning` status. The UI shows:

```text
问题出现在：
Internet → api.openai.com:443
```

and a one-sentence conclusion, e.g.:

```text
目标 api.openai.com:443 连接失败；本机到网关正常。
```

## Drift rules

| Code | Trigger | Severity |
|---|---|---|
| `DRIFT_DSH_PROXY_STALE` | DSH proxy endpoint unreachable/unusable or listener gone | error |
| `DRIFT_WSL_PROXY_STALE` | WSL reaches Windows Host but cannot reach the proxy | error |
| `DRIFT_WINHTTP_STALE` | WinHTTP proxy configured but no listener; DSH path healthy | warning |
| `DRIFT_DSH_ENV_SCOPE_DIFFERENT` | DSH env differs from Windows env but the path is healthy | info |
| `DRIFT_WSL_ENV_DIVERGENT` | Distribution env differs from DSH env but the path is healthy | info |

Configuration difference alone is never an error.

## Legacy rules

Examples:

```text
PROXY_ENDPOINT_UNREACHABLE
PROXY_CONFIGURED_BUT_UNUSABLE
DNS_FAILURE
TLS_FAILURE
WSL_PROXY_UNREACHABLE
WSL_PROXY_LOOPBACK_UNREACHABLE
WSL_AUTOPROXY_STALE
HOSTS_OVERRIDE
```

Drift results can suppress redundant legacy results when both describe the
same failure.

## Graph fallback

If the graph has a failing edge but no rule/drift diagnostic matched, the
system emits:

```text
DSH_PATH_FAILED
```

so “诊断结果” is never empty while the main path shows a failure.

## UI display

```text
诊断
链路                        ✕ 有问题

一句人类可读结论

问题出现在：
<first failing edge>

[查看详情]
  失败层
  错误信息
  Evidence
```

Lower sections keep technical detail for developers:

- Windows environment
- DSH process environment
- WSL distribution environment
- proxy source and listener
- route and gateway evidence
