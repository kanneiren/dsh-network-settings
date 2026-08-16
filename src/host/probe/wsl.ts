/** WSL in-distribution probes. Capability-based: getent → python → curl/wget. */
import type { ProbeCheck } from '../model.ts'
import { runCommand } from '../runtime/command.ts'
import { decodeWslCommand } from '../wsl/encoding.ts'

function wslLaunch(args: readonly string[]): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: 'wsl.exe', args: [...args] }
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', 'wsl.exe', ...args] }
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
  const launch = wslLaunch(['-d', distribution, '--', '/bin/sh'])
  const result = await runCommand(launch.file, launch.args, {
    input: script,
    timeoutMs: options.timeoutMs ?? 6_000,
    signal: options.signal,
    maxStdoutBytes: 64 * 1024,
  })
  return {
    code: result.code,
    stdout: decodeWslCommand(result.stdout),
    stderr: result.stderr,
    timedOut: result.timedOut,
    aborted: result.aborted,
    durationMs: result.durationMs,
  }
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
    return {
      status: 'healthy',
      humanMessage: `${host} 在 WSL 中解析正常`,
      source: `wsl:${distribution}:dns`,
      timestamp: new Date().toISOString(),
      latencyMs: result.durationMs,
      details: { output: result.stdout.trim() },
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
  const script = [
    'if command -v python3 >/dev/null 2>&1; then',
    `  python3 -c 'import socket,sys; s=socket.create_connection((sys.argv[1],int(sys.argv[2])),3); s.close(); print("OK")' ${safe} ${port} && exit 0`,
    'fi',
    'if command -v curl >/dev/null 2>&1; then',
    `  curl -sS --noproxy '*' --connect-timeout 3 --max-time 5 -o /dev/null "http://${safe}:${port}" && exit 0`,
    '  test $? -eq 7 && exit 0 || true',
    'fi',
    'exit 1',
  ].join('\n')
  const result = await runWslScript(distribution, script, options)
  if (result.code === 0) {
    return {
      status: 'healthy',
      humanMessage: `${host}:${port} 在 WSL 中可连接`,
      source: `wsl:${distribution}:tcp`,
      timestamp: new Date().toISOString(),
      latencyMs: result.durationMs,
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
  const script = [
    'if command -v curl >/dev/null 2>&1; then',
    `  code=$(curl -sS --noproxy '*' --connect-timeout 4 --max-time 8 -o /dev/null -w '%{http_code}' ${shellQuote(url)})`,
    '  test "${code}" = "200" -o "${code}" = "301" -o "${code}" = "302" -o "${code}" = "304" && exit 0',
    '  exit 1',
    'fi',
    'if command -v wget >/dev/null 2>&1; then',
    `  wget -q --no-proxy --timeout=6 --spider ${shellQuote(url)} && exit 0`,
    '  exit 1',
    'fi',
    'if command -v python3 >/dev/null 2>&1; then',
    `  python3 -c 'import urllib.request,sys; o=urllib.request.build_opener(urllib.request.ProxyHandler({"http":"","https":""})); o.open(sys.argv[1],timeout=6).read(1); print("OK")' ${shellQuote(url)} && exit 0`,
    'fi',
    'exit 1',
  ].join('\n')
  const result = await runWslScript(distribution, script, options)
  if (result.code === 0) {
    return {
      status: 'healthy',
      humanMessage: `WSL 可直连 ${parsed.host}`,
      source: `wsl:${distribution}:direct`,
      timestamp: new Date().toISOString(),
      latencyMs: result.durationMs,
      details: { output: result.stdout.trim() },
    }
  }
  return wslFailure('WSL_DIRECT_FAILED', `WSL 无法直连 ${parsed.host}`, result)
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
    '  test "${code}" = "200" -o "${code}" = "301" -o "${code}" = "302" -o "${code}" = "304" && exit 0',
    '  exit 1',
    'fi',
    'if command -v python3 >/dev/null 2>&1; then',
    `  python3 -c 'import sys,urllib.request; p=urllib.request.ProxyHandler({"http":sys.argv[1],"https":sys.argv[1]}); o=urllib.request.build_opener(p); o.open(sys.argv[2],timeout=6).read(1); print("OK")' ${shellQuote(proxyUrl)} ${shellQuote(targetUrl)} && exit 0`,
    'fi',
    'exit 1',
  ].join('\n')
  const result = await runWslScript(distribution, script, options)
  if (result.code === 0) {
    return {
      status: 'healthy',
      humanMessage: `WSL 可经代理访问 ${parsed.host}`,
      source: `wsl:${distribution}:proxy`,
      timestamp: new Date().toISOString(),
      latencyMs: result.durationMs,
      details: { output: result.stdout.trim() },
    }
  }
  return wslFailure('WSL_PROXY_FAILED', `WSL 无法经代理访问 ${parsed.host}`, result)
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
