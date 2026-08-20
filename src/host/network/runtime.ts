/**
 * Runtime model detection.
 *
 * Only two supported network models exist: WINDOWS_NATIVE and WSL_DISTRIBUTION.
 * A Linux process that is not a WSL distribution is UNSUPPORTED_RUNTIME and is
 * never misclassified as WSL. Detection is static (process env + /proc files)
 * so it works with WSL interop disabled.
 */
import { existsSync, readFileSync } from 'node:fs'
import type { WslInspection } from '../model.ts'
import type {
  DetectedRuntime, MacNativeRuntime, PathConfidence, UnsupportedRuntime, WindowsNativeRuntime,
  WslDistributionRuntime, WslLinuxMetadata,
} from './types.ts'

export interface RuntimeDetectionInput {
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  procVersion?: string
  osRelease?: string
  cgroup?: string
  interopAvailable?: boolean
}

export interface RuntimeSignals {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  procVersion?: string
  osRelease?: string
  cgroup?: string
  interopAvailable: boolean
}

const MICROSOFT_KERNEL = /microsoft/i
const WSL2_KERNEL = /microsoft-standard-wsl2/i
const WSL1_KERNEL = /microsoft/i
const CONTAINER_CGROUP = /(?:^|[/,-])(?:docker|containerd|kubepods|libpod)(?:[/.-]|$)/i

function envMap(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Record<string, string | undefined> {
  return env as Record<string, string | undefined>
}

function firstValue(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

export function parseOsRelease(text: string): WslLinuxMetadata {
  const result: WslLinuxMetadata = { kernelRelease: '' }
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
    if (match === null) continue
    const value = (match[2] ?? '').replace(/^['"]|['"]$/g, '')
    if (match[1] === 'PRETTY_NAME') result.prettyName = value
    if (match[1] === 'ID') result.id = value
    if (match[1] === 'VERSION_ID') result.versionId = value
    if (match[1] === 'VERSION_CODENAME') result.versionCodename = value
  }
  return result
}

export function wslVersionFromKernel(text: string): 1 | 2 | undefined {
  if (WSL2_KERNEL.test(text)) return 2
  if (WSL1_KERNEL.test(text)) return 1
  return undefined
}

export function looksLikeWslKernel(text: string): boolean {
  return MICROSOFT_KERNEL.test(text)
}

/**
 * Pure runtime detection. Linux containers running on top of WSL are
 * UNSUPPORTED_RUNTIME (they are not a WSL Distribution user space).
 */
export function detectRuntime(input: RuntimeDetectionInput = {}): DetectedRuntime {
  const platform = input.platform ?? process.platform
  const env = input.env ?? envMap(process.env)
  const procVersion = input.procVersion ?? readOptional('/proc/version')
  const osReleaseText = input.osRelease ?? readOptional('/etc/os-release')
  const cgroup = input.cgroup ?? readOptional('/proc/1/cgroup')
  const interopAvailable = input.interopAvailable ?? existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')

  if (platform === 'win32') {
    const runtime: WindowsNativeRuntime = {
      type: 'WINDOWS_NATIVE',
      platform: 'win32',
      nodeVersion: process.version,
      confidence: env['OS'] === 'Windows_NT' ? 'verified' : 'inferred',
    }
    return runtime
  }

  if (platform === 'darwin') {
    const runtime: MacNativeRuntime = {
      type: 'MACOS_NATIVE',
      platform: 'darwin',
      nodeVersion: process.version,
      confidence: 'verified',
    }
    return runtime
  }

  if (platform !== 'linux') {
    return unsupported(String(platform), 'UNKNOWN_PLATFORM')
  }

  const kernelText = procVersion ?? ''
  const linux = { ...parseOsRelease(osReleaseText ?? ''), kernelRelease: kernelText.split('\n')[0] ?? '' }
  const distroName = firstValue(env, 'WSL_DISTRO_NAME')
  const wslKernel = looksLikeWslKernel(kernelText)
  const inContainer = CONTAINER_CGROUP.test(cgroup ?? '')

  if (wslKernel && inContainer && distroName === undefined) {
    return unsupported('linux', 'LINUX_CONTAINER_ON_WSL')
  }

  if (!wslKernel && distroName === undefined) {
    return unsupported('linux', 'LINUX_NOT_WSL')
  }

  const wslVersion = wslVersionFromKernel(kernelText)
  const confidence: PathConfidence = wslKernel && distroName !== undefined ? 'verified' : 'inferred'
  const displayName = linux.prettyName ?? linux.id ?? distroName ?? 'WSL Distribution'

  const runtime: WslDistributionRuntime = {
    type: 'WSL_DISTRIBUTION',
    confidence,
    ...distroName === undefined ? {} : { registeredName: distroName },
    displayName,
    linux,
    ...wslVersion === undefined ? {} : { wslVersion },
    networkLayer: {
      mode: wslVersion === 1 ? 'WSL1' : wslVersion === 2 ? 'NAT' : 'UNKNOWN',
      modeConfigured: false,
    },
    interopAvailable,
  }
  return runtime
}

function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

function unsupported(platform: string, reason: UnsupportedRuntime['reason']): UnsupportedRuntime {
  return {
    type: 'UNSUPPORTED_RUNTIME',
    platform,
    reason,
    humanMessage: reason === 'LINUX_CONTAINER_ON_WSL'
      ? 'DSH 运行在 WSL 上的 Linux 容器中；当前插件只支持 Windows 原生或直接运行在 WSL Distribution 用户空间。'
      : reason === 'LINUX_NOT_WSL'
        ? 'DSH 运行在非 WSL 的 Linux 环境中；当前插件只支持 Windows 原生与 WSL Distribution。'
        : `暂不支持当前运行平台：${platform}`,
  }
}

/** Collect real runtime signals from the current process (read-only). */
export function collectRuntimeSignals(): RuntimeSignals {
  return {
    platform: process.platform,
    env: envMap(process.env),
    ...readOptional('/proc/version') === undefined ? {} : { procVersion: readOptional('/proc/version') },
    ...readOptional('/etc/os-release') === undefined ? {} : { osRelease: readOptional('/etc/os-release') },
    ...readOptional('/proc/1/cgroup') === undefined ? {} : { cgroup: readOptional('/proc/1/cgroup') },
    interopAvailable: existsSync('/proc/sys/fs/binfmt_misc/WSLInterop'),
  }
}

function normalizeMode(mode: string | undefined, wslVersion: 1 | 2 | undefined): WslDistributionRuntime['networkLayer']['mode'] {
  const normalized = mode?.toLowerCase()
  if (wslVersion === 1) return 'WSL1'
  if (normalized === 'mirrored') return 'MIRRORED'
  if (normalized === 'bridged') return 'BRIDGED'
  if (normalized === 'none') return 'NONE'
  if (normalized === 'virtioproxy') return 'VIRTIOPROXY'
  if (normalized === 'nat' || normalized === undefined || normalized === '') return 'NAT'
  return 'UNKNOWN'
}

/**
 * Corroborate a detected WSL runtime with host-side `wsl.exe` facts. The
 * registered name still comes from WSL_DISTRO_NAME first; when it is missing
 * and exactly one distribution is running, that sole running distribution is
 * used as an inferred registered name.
 */
export function enrichWslRuntime(
  runtime: WslDistributionRuntime,
  wsl: WslInspection | undefined,
): WslDistributionRuntime {
  if (wsl === undefined || !wsl.available) return runtime
  const running = wsl.distributions.filter(distribution => distribution.state === 'running')
  const matched = runtime.registeredName === undefined
    ? (running.length === 1 ? running[0] : undefined)
    : running.find(distribution => distribution.name === runtime.registeredName)

  const wslVersion = runtime.wslVersion ?? matched?.wslVersion
  const globalMode = wsl.globalConfig?.mode
  return {
    ...runtime,
    ...runtime.registeredName === undefined && matched !== undefined ? { registeredName: matched.name, confidence: 'inferred' as const } : {},
    ...wslVersion === undefined ? {} : { wslVersion },
    networkLayer: {
      mode: normalizeMode(globalMode, wslVersion),
      modeConfigured: wsl.globalConfig?.modeConfigured === true,
      ...wsl.globalConfig?.dnsTunneling === undefined ? {} : { dnsTunneling: wsl.globalConfig.dnsTunneling },
      ...wsl.globalConfig?.autoProxy === undefined ? {} : { autoProxy: wsl.globalConfig.autoProxy },
    },
  }
}

export function finalizeRuntime(runtime: DetectedRuntime, wsl: WslInspection | undefined): DetectedRuntime {
  if (runtime.type === 'WSL_DISTRIBUTION') return enrichWslRuntime(runtime, wsl)
  if (runtime.type === 'WINDOWS_NATIVE') return runtime
  return runtime
}
