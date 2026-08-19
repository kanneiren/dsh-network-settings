/** WSL in-distribution probes. Capability-based: getent → python → curl/wget. */
import type { ProbeCheck } from '../model.ts'
import { runCommand } from '../runtime/command.ts'
import { decodeWslCommand } from '../wsl/encoding.ts'

function wslLaunch(args: readonly string[]): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: 'wsl.exe', args: [...args] }
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', 'wsl.exe', ...args] }
}

/** The distribution this process runs in, when the host Node is Linux-side. */
function currentDistributionName(): string | undefined {
  return process.platform === 'linux' ? process.env['WSL_DISTRO_NAME'] : undefined
}

export interface WslScriptResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  durationMs: number
}

export async function runWslScript(
  distribution: string,
  script: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<WslScriptResult> {
  // When the host process already runs inside the target distribution, a
  // cmd.exe → wsl.exe -d <self> interop round-trip is slow and can hang
  // re-entering the same distro; spawn /bin/sh directly instead.
  const launch = distribution === currentDistributionName()
    ? { file: '/bin/sh', args: [] as string[] }
    : wslLaunch(['-d', distribution, '--', '/bin/sh'])
  const result = await runCommand(launch.file, launch.args, {
    input: script,
    timeoutMs: options.timeoutMs ?? 6_000,
    signal: options.signal,
    maxStdoutBytes: 64 * 1024,
  })
  return {
    code: result.code,
    stdout: decodeWslCommand(result.stdout),
    stderr: cleanWslStderr(result.stderr),
    timedOut: result.timedOut,
    aborted: result.aborted,
    durationMs: result.durationMs,
  }
}

/**
 * `wsl.exe` may print its own localhost-relay warning to stderr before the
 * Linux command output. It is emitted as UTF-16 over a UTF-8 pipe, producing
 * mojibake such as `wsl: �hKm0R localhost ...`. Those lines are launcher
 * noise, not probe evidence, so drop them while keeping curl/python errors.
 */
export function cleanWslStderr(stderr: string): string {
  return stderr
    .replaceAll('\0', '')
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => {
      const trimmed = line.trim()
      if (trimmed === '') return false
      if (/^wsl:\s/.test(trimmed)) return false
      if (/localhost.*(?:WSL|NAT|localhost)/i.test(trimmed) && trimmed.includes('wsl')) return false
      return true
    })
    .join('\n')
    .trim()
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function hostSafe(value: string): string {
  if (!/^[A-Za-z0-9.:[\]_-]+$/.test(value)) throw new Error(`unsafe host for WSL probe: ${value}`)
  return value
}

export interface WslProbeOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

/** Extract unique IPv4 addresses from getent/python DNS output lines. */
export function addressesFromDnsOutput(output: string): string[] {
  const addresses = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    const first = line.trim().split(/\s+/)[0] ?? ''
    if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(first)) addresses.add(first)
  }
  return [...addresses]
}

export async function probeWslDns(
  distribution: string,
  host: string,
  options: WslProbeOptions = {},
): Promise<ProbeCheck> {
  const safe = hostSafe(host)
  const started = performance.now()
  const script = [
    'if command -v getent >/dev/null 2>&1; then',
    `  if getent ahostsv4 ${safe} 2>/dev/null | head -n 1; then exit 0; fi`,
    `  if getent hosts ${safe} 2>/dev/null | head -n 1; then exit 0; fi`,
    'fi',
    'if command -v python3 >/dev/null 2>&1; then',
    `  python3 -c 'import socket,sys; print(socket.gethostbyname(sys.argv[1]))' ${safe} && exit 0`,
    'fi',
    'exit 1',
  ].join('\n')
  const result = await runWslScript(distribution, script, options)
  if (result.code === 0) {
    const addresses = addressesFromDnsOutput(result.stdout)
    return {
      status: 'healthy',
      humanMessage: `${host} 在 WSL 中解析正常`,
      source: `wsl:${distribution}:dns`,
      timestamp: new Date().toISOString(),
      latencyMs: result.durationMs,
      details: { output: result.stdout.trim(), ...(addresses.length > 0 ? { addresses } : {}) },
    }
  }
  return wslFailure('WSL_DNS_FAILED', `WSL 无法解析 ${host}`, result)
}

export async function probeWslTcp(
  distribution: string,
  host: string,
  port: number,
  options: WslProbeOptions = {},
): Promise<ProbeCheck> {
  const safe = hostSafe(host)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port: ${port}`)
  // Exit-code contract:
  //   0 = TCP 可连，或连接被拒绝（RST，即主机可达只是端口未监听）
  //   2 = 连接超时（SYN 被丢弃，常见于防火墙/静默丢包，可达性存疑）
  //   1 = 其他失败
  const script = [
    'if command -v python3 >/dev/null 2>&1; then',
    `  python3 -c 'import socket,sys; s=socket.create_connection((sys.argv[1],int(sys.argv[2])),2); s.close(); print("OK")' ${safe} ${port} && exit 0`,
    'fi',
    'if command -v curl >/dev/null 2>&1; then',
    `  curl -sS --noproxy '*' --connect-timeout 3 --max-time 5 -o /dev/null "http://${safe}:${port}"`,
    '  rc=$?',
    '  test "$rc" -eq 0 -o "$rc" -eq 7 && exit 0',
    '  test "$rc" -eq 28 && exit 2',
    'fi',
    'exit 1',
  ].join('\n')
  const result = await runWslScript(distribution, script, options)
  return tcpCheckFromResult(`wsl:${distribution}:tcp`, host, port, result)
}

/**
 * Classify the WSL TCP probe script result. Extracted for unit testing.
 * A dropped SYN (timeout) is ambiguous reachability evidence — e.g. the
 * Windows host has nothing listening on the probed port and a firewall
 * drops instead of refusing — so it becomes a warning, not an error.
 */
export function tcpCheckFromResult(source: string, host: string, port: number, result: WslScriptResult): ProbeCheck {
  if (result.code === 0) {
    return {
      status: 'healthy',
      humanMessage: `${host}:${port} 在 WSL 中可连接`,
      source,
      timestamp: new Date().toISOString(),
      latencyMs: result.durationMs,
    }
  }
  if (result.code === 2 || result.timedOut) {
    return {
      status: 'warning',
      errorCode: 'WSL_TCP_TIMEOUT',
      humanMessage: `${host}:${port} 未响应（连接超时 · 可能被防火墙丢弃）`,
      technicalMessage: result.stderr.trim() || result.stdout.trim() || `exit ${String(result.code)}`,
      source: 'wsl:/bin/sh',
      timestamp: new Date().toISOString(),
      ...result.timedOut ? { details: { timedOut: true } } : {},
    }
  }
  return wslFailure('WSL_TCP_FAILED', `WSL 无法连接 ${host}:${port}`, result)
}

export async function probeWslDirectInternet(
  distribution: string,
  url: string,
  options: WslProbeOptions = {},
): Promise<ProbeCheck> {
  const parsed = new URL(url)
  // Connectivity = an HTTP response was received, regardless of its status
  // code. api.deepseek.com answers unauthenticated requests with 401, which
  // still proves DNS/TCP/TLS/HTTP all work. Accepting only 2xx/3xx here
  // turned a healthy link into a permanent false failure.
  const script = [
    'if command -v curl >/dev/null 2>&1; then',
    `  code=$(curl -sS --noproxy '*' --connect-timeout 4 --max-time 8 -o /dev/null -w '%{http_code}' ${shellQuote(url)})`,
    '  rc=$?',
    '  if [ "$rc" -eq 0 ]; then printf "HTTP %s" "$code"; exit 0; fi',
    '  exit 1',
    'fi',
    'if command -v wget >/dev/null 2>&1; then',
    `  wget -q --no-proxy --timeout=6 --spider ${shellQuote(url)}`,
    '  rc=$?',
    '  test "$rc" -eq 0 -o "$rc" -eq 8 && exit 0',
    '  exit 1',
    'fi',
    'if command -v python3 >/dev/null 2>&1; then',
    `  python3 -c 'import sys,urllib.request,urllib.error
o=urllib.request.build_opener(urllib.request.ProxyHandler({"http":"","https":""}))
try:
    o.open(sys.argv[1],timeout=6).read(1)
except urllib.error.HTTPError:
    pass
print("OK")' ${shellQuote(url)} && exit 0`,
    'fi',
    'exit 1',
  ].join('\n')
  const result = await runWslScript(distribution, script, options)
  return internetCheckFromResult(`wsl:${distribution}:direct`, 'direct', parsed.host, result)
}

export async function probeWslProxyInternet(
  distribution: string,
  proxyUrl: string,
  targetUrl: string,
  options: WslProbeOptions = {},
): Promise<ProbeCheck> {
  const parsed = new URL(targetUrl)
  const script = [
    'if command -v curl >/dev/null 2>&1; then',
    `  code=$(curl -sS --connect-timeout 4 --max-time 8 -x ${shellQuote(proxyUrl)} -o /dev/null -w '%{http_code}' ${shellQuote(targetUrl)})`,
    '  rc=$?',
    '  if [ "$rc" -eq 0 ]; then printf "HTTP %s" "$code"; exit 0; fi',
    '  exit 1',
    'fi',
    'if command -v python3 >/dev/null 2>&1; then',
    `  python3 -c 'import sys,urllib.request,urllib.error
o=urllib.request.build_opener(urllib.request.ProxyHandler({"http":sys.argv[1],"https":sys.argv[1]}))
try:
    o.open(sys.argv[2],timeout=6).read(1)
except urllib.error.HTTPError:
    pass
print("OK")' ${shellQuote(proxyUrl)} ${shellQuote(targetUrl)} && exit 0`,
    'fi',
    'exit 1',
  ].join('\n')
  const result = await runWslScript(distribution, script, options)
  return internetCheckFromResult(`wsl:${distribution}:proxy`, 'proxy', parsed.host, result)
}

/**
 * Classify the WSL direct/proxy internet probe script result. Extracted for
 * unit testing. Any received HTTP status code counts as reachable.
 */
export function internetCheckFromResult(
  source: string,
  kind: 'direct' | 'proxy',
  host: string,
  result: WslScriptResult,
): ProbeCheck {
  if (result.code === 0) {
    const match = /(?:^|\D)(\d{3})(?:\D|$)/.exec(result.stdout)
    const statusSuffix = match === null ? '' : `（HTTP ${match[1]}）`
    return {
      status: 'healthy',
      humanMessage: kind === 'direct' ? `WSL 可直连 ${host}${statusSuffix}` : `WSL 可经代理访问 ${host}${statusSuffix}`,
      source,
      timestamp: new Date().toISOString(),
      latencyMs: result.durationMs,
      details: { output: result.stdout.trim() },
    }
  }
  return wslFailure(
    kind === 'direct' ? 'WSL_DIRECT_FAILED' : 'WSL_PROXY_FAILED',
    kind === 'direct' ? `WSL 无法直连 ${host}` : `WSL 无法经代理访问 ${host}`,
    result,
  )
}

function wslFailure(errorCode: string, humanMessage: string, result: WslScriptResult): ProbeCheck {
  return {
    status: 'error',
    errorCode,
    humanMessage,
    technicalMessage: result.stderr.trim() || result.stdout.trim() || `exit ${String(result.code)}`,
    source: 'wsl:/bin/sh',
    timestamp: new Date().toISOString(),
    ...result.timedOut ? { details: { timedOut: true } } : {},
  }
}
