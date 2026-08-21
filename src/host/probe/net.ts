/** Low-level network probes: DNS, TCP, TLS, HTTP(S), HTTP CONNECT tunnel. * Module facade: Public surface: combinedSignal() + the layer probes. Pure-Node sockets, cancellable and time-bounded.
 */
import dns from 'node:dns/promises'
import net from 'node:net'
import tls from 'node:tls'
import http from 'node:http'
import https from 'node:https'
import type { ProbeCheck } from '../model.ts'

export interface ProbeTimerOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export function combinedSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController()
  const cancel = (): void => { controller.abort() }
  if (parent?.aborted === true) controller.abort()
  else parent?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  timer.unref?.()
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', cancel)
      controller.abort()
    },
  }
}

function check(id: string, humanMessage: string, source: string, details: Record<string, unknown> = {}): ProbeCheck {
  return { status: 'healthy', humanMessage, source, timestamp: new Date().toISOString(), details }
}

export interface DnsProbeResult {
  addresses: string[]
  latencyMs?: number
  family: 4 | 6
}

/** Extract unique addresses from allSettled DNS results. */
function dnsAddresses(results: Array<PromiseSettledResult<string[]>>): { addresses: string[]; family: 4 | 6; firstError: unknown } {
  const addresses: string[] = []
  let family: 4 | 6 = 4
  for (const [index, settled] of results.entries()) {
    if (settled.status === 'fulfilled') {
      addresses.push(...settled.value)
      if (addresses.length > 0 && index === 0) family = 4
    }
  }
  const firstError = results[0]?.status === 'rejected' ? results[0].reason
    : results[1]?.status === 'rejected' ? results[1].reason : undefined
  return { addresses, family, firstError }
}

export async function probeDns(host: string, options: ProbeTimerOptions = {}): Promise<ProbeCheck & DnsProbeResult> {
  const timeoutMs = options.timeoutMs ?? 4_000
  const { signal, cancel } = combinedSignal(options.signal, timeoutMs)
  const resolver = new dns.Resolver()
  const stop = (): void => { resolver.cancel() }
  if (signal.aborted) stop()
  else signal.addEventListener('abort', stop, { once: true })
  const started = performance.now()
  try {
    const { addresses, family, firstError } = dnsAddresses(await Promise.allSettled([
      resolver.resolve4(host),
      resolver.resolve6(host),
    ]))
    if (addresses.length === 0) {
      return {
        ...check('dns', `无法解析 ${host}`, 'node:dns', { host }),
        status: 'error',
        errorCode: aborted(signal) ? 'DNS_CANCELLED' : 'DNS_FAILED',
        humanMessage: aborted(signal) ? `解析 ${host} 超时（${String(timeoutMs)}ms）` : `无法解析 ${host}`,
        technicalMessage: errorMessage(firstError),
        addresses: [],
        family: 4,
        details: { host, timeoutMs },
      }
    }
    return {
      ...check('dns', `${host} 解析正常`, 'node:dns', { host, addresses }),
      latencyMs: Math.round(performance.now() - started),
      addresses,
      family,
    }
  } catch (error) {
    return {
      status: 'error',
      errorCode: aborted(signal) ? 'DNS_CANCELLED' : 'DNS_FAILED',
      humanMessage: `无法解析 ${host}`,
      technicalMessage: errorMessage(error),
      source: 'node:dns',
      timestamp: new Date().toISOString(),
      addresses: [],
      family: 4,
      details: { host },
    }
  } finally {
    cancel()
  }
}

export interface TcpProbeResult {
  address?: string
  latencyMs?: number
}

export async function probeTcp(host: string, port: number, options: ProbeTimerOptions = {}): Promise<ProbeCheck & TcpProbeResult> {
  const timeoutMs = options.timeoutMs ?? 4_000
  const started = performance.now()
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, signal: options.signal })
    const timer = setTimeout(() => { socket.destroy(new Error(`TCP timeout after ${timeoutMs}ms`)) }, timeoutMs)
    timer.unref?.()
    socket.once('connect', () => {
      clearTimeout(timer)
      const latencyMs = Math.round(performance.now() - started)
      socket.destroy()
      resolve({
        ...check('tcp', `${host}:${port} 可连接`, 'node:net', { host, port }),
        latencyMs,
        address: socket.remoteAddress,
      })
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      resolve({
        status: 'error',
        errorCode: aborted(options.signal) ? 'TCP_CANCELLED' : 'TCP_FAILED',
        humanMessage: `无法连接 ${host}:${port}`,
        technicalMessage: errorMessage(error),
        source: 'node:net',
        timestamp: new Date().toISOString(),
        details: { host, port },
      })
    })
    socket.once('close', () => {
      clearTimeout(timer)
    })
  })
}

export interface TlsProbeResult {
  latencyMs?: number
  authorized: boolean
  protocol?: string
  subject?: string
}

export async function probeTls(host: string, port = 443, options: ProbeTimerOptions = {}): Promise<ProbeCheck & TlsProbeResult> {
  const timeoutMs = options.timeoutMs ?? 6_000
  const started = performance.now()
  return new Promise((resolve) => {
    const socket = tls.connect({
      host,
      port,
      servername: host,
      rejectUnauthorized: true,
      ...(options.signal === undefined ? {} : { signal: options.signal as AbortSignal }),
    } as tls.ConnectionOptions)
    const timer = setTimeout(() => { socket.destroy(new Error(`TLS timeout after ${timeoutMs}ms`)) }, timeoutMs)
    timer.unref?.()
    socket.once('secureConnect', () => {
      clearTimeout(timer)
      const latencyMs = Math.round(performance.now() - started)
      const cert = socket.getPeerCertificate(false) as unknown as Record<string, unknown>
      socket.destroy()
      resolve({
        ...check('tls', `${host}:${port} TLS 握手成功`, 'node:tls', { host, port }),
        latencyMs,
        authorized: socket.authorized,
        ...socket.getProtocol() === null ? {} : { protocol: socket.getProtocol() ?? undefined },
        ...typeof cert.subject === 'string' ? {} : { subject: Object.entries(cert.subject ?? {}).map(([key, value]) => `${key}=${String(value)}`).join(',') },
      })
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      resolve({
        status: 'error',
        errorCode: aborted(options.signal) ? 'TLS_CANCELLED' : 'TLS_FAILED',
        humanMessage: `${host}:${port} TLS 握手失败`,
        technicalMessage: errorMessage(error),
        source: 'node:tls',
        timestamp: new Date().toISOString(),
        authorized: false,
        details: { host, port },
      })
    })
  })
}

export interface HttpProbeResult {
  statusCode?: number
  latencyMs?: number
  viaProxy: boolean
  url: string
}

export async function probeHttp(url: string, options: ProbeTimerOptions & { method?: string } = {}): Promise<ProbeCheck & HttpProbeResult> {
  const timeoutMs = options.timeoutMs ?? 8_000
  const started = performance.now()
  // The timeout must cover both the response headers and the body read: a
  // server (or middlebox) that accepts the connection and then stalls would
  // otherwise hang the probe until the caller aborts.
  const { signal, cancel } = combinedSignal(options.signal, timeoutMs)
  try {
    const response = await fetch(url, {
      method: options.method ?? 'HEAD',
      redirect: 'follow',
      signal,
      headers: { 'user-agent': 'dsh-network-settings/0.3' },
    })
    const latencyMs = Math.round(performance.now() - started)
    await response.arrayBuffer().catch(() => {})
    return {
      ...check('http', `${url} 返回 ${response.status}`, 'node:fetch', { url }),
      statusCode: response.status,
      latencyMs,
      viaProxy: false,
      url,
    }
  } catch (error) {
    return {
      status: 'error',
      errorCode: aborted(signal) ? 'HTTP_CANCELLED' : 'HTTP_FAILED',
      humanMessage: aborted(signal) ? `访问 ${url} 超时（${String(timeoutMs)}ms）` : `无法访问 ${url}`,
      technicalMessage: errorMessage(error),
      source: 'node:fetch',
      timestamp: new Date().toISOString(),
      viaProxy: false,
      url,
      details: { url, timeoutMs },
    }
  } finally {
    cancel()
  }
}

/**
 * Minimal HTTP CONNECT tunnel used for HTTPS targets through an HTTP proxy.
 * Returns the established socket after the proxy accepts the tunnel.
 */
export function openHttpTunnel(
  proxyHost: string,
  proxyPort: number,
  targetHost: string,
  targetPort: number,
  options: ProbeTimerOptions = {},
): Promise<net.Socket> {
  const timeoutMs = options.timeoutMs ?? 5_000
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: proxyHost, port: proxyPort, signal: options.signal })
    const timer = setTimeout(() => { socket.destroy(new Error(`proxy CONNECT timeout after ${timeoutMs}ms`)) }, timeoutMs)
    timer.unref?.()
    const onError = (error: Error): void => { clearTimeout(timer); reject(error) }
    socket.once('error', onError)
    socket.once('connect', () => {
      socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nProxy-Connection: keep-alive\r\n\r\n`)
      let buffer = ''
      const onData = (chunk: Buffer): void => {
        buffer += chunk.toString('latin1')
        if (!buffer.includes('\r\n\r\n')) return
        socket.off('data', onData)
        const status = /^HTTP\/1\.[01]\s+(\d{3})/.exec(buffer)
        if (status?.[1] !== '200') {
          clearTimeout(timer)
          socket.destroy()
          reject(new Error(`proxy CONNECT rejected with status ${status?.[1] ?? 'unknown'}`))
          return
        }
        clearTimeout(timer)
        socket.removeListener('error', onError)
        resolve(socket)
      }
      socket.on('data', onData)
    })
  })
}

/** Perform an HTTPS HEAD request through an already-established proxy CONNECT tunnel. */
export function probeHttpsThroughSocket(
  socket: net.Socket,
  targetHost: string,
  url: URL,
  options: ProbeTimerOptions = {},
): Promise<{ statusCode: number; latencyMs: number; protocol?: string; authorized: boolean }> {
  const timeoutMs = options.timeoutMs ?? 8_000
  const started = performance.now()
  return new Promise((resolve, reject) => {
    const secure = tls.connect({
      socket,
      servername: targetHost,
      rejectUnauthorized: true,
      ...(options.signal === undefined ? {} : { signal: options.signal as AbortSignal }),
    } as tls.ConnectionOptions)
    const timer = setTimeout(() => { secure.destroy(new Error(`proxy HTTPS timeout after ${timeoutMs}ms`)) }, timeoutMs)
    timer.unref?.()
    secure.once('secureConnect', () => {
      const path = `${url.pathname}${url.search}`
      secure.write(`HEAD ${path} HTTP/1.1\r\nHost: ${url.host}\r\nUser-Agent: dsh-network-settings/0.3\r\nConnection: close\r\n\r\n`)
      let buffer = ''
      secure.on('data', (chunk) => {
        buffer += chunk.toString('latin1')
        const end = buffer.indexOf('\r\n\r\n')
        if (end < 0) return
        const status = /^HTTP\/1\.[01]\s+(\d{3})/.exec(buffer)
        clearTimeout(timer)
        secure.destroy()
        resolve({
          statusCode: status?.[1] === undefined ? 0 : Number(status[1]),
          latencyMs: Math.round(performance.now() - started),
          ...secure.getProtocol() === null ? {} : { protocol: secure.getProtocol() ?? undefined },
          authorized: secure.authorized,
        })
      })
    })
    secure.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

/** HTTP request through an HTTP proxy (absolute-URI form). */
export function probeHttpThroughProxy(
  targetUrl: URL,
  proxyHost: string,
  proxyPort: number,
  options: ProbeTimerOptions = {},
): Promise<{ statusCode: number; latencyMs: number }> {
  const timeoutMs = options.timeoutMs ?? 8_000
  const started = performance.now()
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: proxyHost,
      port: proxyPort,
      path: targetUrl.toString(),
      method: 'HEAD',
      headers: { host: targetUrl.host, 'user-agent': 'dsh-network-settings/0.3' },
      timeout: timeoutMs,
      signal: options.signal,
    }, (response) => {
      response.resume()
      response.once('end', () => {
        resolve({ statusCode: response.statusCode ?? 0, latencyMs: Math.round(performance.now() - started) })
      })
    })
    request.once('timeout', () => request.destroy(new Error(`proxy HTTP timeout after ${timeoutMs}ms`)))
    request.once('error', reject)
    request.end()
  })
}

export interface RepeatedProbeOptions extends ProbeTimerOptions {
  attempts?: number
  intervalMs?: number
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function attemptSummary(checks: readonly ProbeCheck[]): Record<string, unknown> {
  const successes = checks.filter(check => check.status === 'healthy')
  const latencies = successes.map(check => check.latencyMs).filter((value): value is number => value !== undefined)
  return {
    attempts: checks.map(check => ({ status: check.status, latencyMs: check.latencyMs, error: check.technicalMessage ?? check.humanMessage })),
    attemptCount: checks.length,
    successCount: successes.length,
    successRate: checks.length === 0 ? 0 : Math.round((successes.length / checks.length) * 100),
    ...latencies.length === 0 ? {} : {
      avgLatencyMs: Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
      minLatencyMs: Math.min(...latencies),
      maxLatencyMs: Math.max(...latencies),
    },
  }
}

function aggregateStatus(checks: readonly ProbeCheck[]): 'healthy' | 'warning' | 'error' {
  if (checks.length === 0) return 'error'
  const successes = checks.filter(check => check.status === 'healthy').length
  if (successes === checks.length) return 'healthy'
  if (successes > 0) return 'warning'
  return 'error'
}

/** Repeat TCP connect attempts and expose success rate / latency spread. */
export async function probeTcpRepeated(host: string, port: number, options: RepeatedProbeOptions = {}): Promise<ProbeCheck & TcpProbeResult> {
  const attempts = options.attempts ?? 1
  const intervalMs = options.intervalMs ?? 0
  const checks: Array<ProbeCheck & TcpProbeResult> = []
  for (let index = 0; index < attempts; index += 1) {
    checks.push(await probeTcp(host, port, options))
    if (index < attempts - 1 && intervalMs > 0) await delay(intervalMs)
  }
  const status = aggregateStatus(checks)
  const healthyChecks = checks.filter(check => check.status === 'healthy')
  return {
    status,
    humanMessage: status === 'healthy'
      ? `${host}:${port} ${attempts}/${attempts} 次连接成功`
      : status === 'warning'
        ? `${host}:${port} ${healthyChecks.length}/${attempts} 次连接成功（不稳定）`
        : `${host}:${port} ${attempts} 次连接均失败`,
    technicalMessage: checks.map(check => check.technicalMessage ?? check.humanMessage).join(' | '),
    source: 'node:net',
    timestamp: new Date().toISOString(),
    latencyMs: healthyChecks[0]?.latencyMs,
    address: healthyChecks[0]?.address,
    details: { host, port, ...attemptSummary(checks) },
  }
}

/** Repeat HTTP requests and expose success rate / latency spread. */
export async function probeHttpRepeated(url: string, options: RepeatedProbeOptions & { method?: string } = {}): Promise<ProbeCheck & HttpProbeResult> {
  const attempts = options.attempts ?? 1
  const intervalMs = options.intervalMs ?? 0
  const checks: Array<ProbeCheck & HttpProbeResult> = []
  for (let index = 0; index < attempts; index += 1) {
    checks.push(await probeHttp(url, options))
    if (index < attempts - 1 && intervalMs > 0) await delay(intervalMs)
  }
  const status = aggregateStatus(checks)
  const healthyChecks = checks.filter(check => check.status === 'healthy')
  return {
    status,
    humanMessage: status === 'healthy'
      ? `${url} ${attempts}/${attempts} 次请求成功`
      : status === 'warning'
        ? `${url} ${healthyChecks.length}/${attempts} 次请求成功（不稳定）`
        : `${url} ${attempts} 次请求均失败`,
    technicalMessage: checks.map(check => check.technicalMessage ?? check.humanMessage).join(' | '),
    source: 'node:fetch',
    timestamp: new Date().toISOString(),
    latencyMs: healthyChecks[0]?.latencyMs,
    viaProxy: false,
    url,
    details: { url, ...attemptSummary(checks) },
  }
}

function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
