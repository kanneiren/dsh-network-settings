/** Atomic repair-operation catalog. Every operation targets one scope and is
 * independent: no operation includes another operation. * Module facade: Public surface: repairCatalog(), diagnosisActionOperations(), isRecommendableOperation(), RECOMMEND_CONFIDENCE_THRESHOLD, findRepairOperation().
 */
import type { ConfigureRequest } from '../configure/index.ts'
import type { DiagnosisAction } from '../diagnose/model.ts'

export type RepairOperationKind = 'configure' | 'advanced'

export interface RepairOperation {
  id: string
  label: string
  description: string
  scope: string
  risk: 'low' | 'medium' | 'high'
  requiresAdmin: boolean
  requiresReboot: boolean
  recoverable: boolean
  kind: RepairOperationKind
  /** Runtime platform this operation applies to; undefined means all platforms. */
  platform?: 'windows' | 'macos'
  /** Only for kind=configure. */
  request?: ConfigureRequest
  /** Only for kind=advanced. */
  advancedId?: string
}

const CONFIGURE_OPERATIONS: RepairOperation[] = [
  {
    id: 'clear-dsh-process-proxy',
    label: '清除当前 DSH 进程代理',
    description: '只清除当前 DSH 进程的 HTTP(S)/NO_PROXY 代理变量，并持久化到插件配置。',
    scope: 'dsh.process',
    risk: 'low',
    requiresAdmin: false,
    requiresReboot: false,
    recoverable: true,
    kind: 'configure',
    request: { scope: 'dsh.process', action: 'clear' },
  },
  {
    id: 'clear-user-env-proxy',
    label: '清除 Windows 用户环境变量代理',
    description: '只清除当前 Windows 用户作用域的 8 个代理环境变量。',
    scope: 'windows.env.user',
    risk: 'low',
    requiresAdmin: false,
    requiresReboot: false,
    recoverable: true,
    kind: 'configure',
    request: { scope: 'windows.env.user', action: 'clear' },
  },
  {
    id: 'clear-machine-env-proxy',
    platform: 'windows',
    label: '清除 Windows 机器环境变量代理',
    description: '只清除 Machine 作用域的 8 个代理环境变量；执行时触发 UAC。',
    scope: 'windows.env.machine',
    risk: 'medium',
    requiresAdmin: true,
    requiresReboot: false,
    recoverable: true,
    kind: 'configure',
    request: { scope: 'windows.env.machine', action: 'clear' },
  },
  {
    id: 'clear-wininet-user-proxy',
    platform: 'windows',
    label: '关闭并清除 Windows 用户代理（WinINet）',
    description: '只关闭 WinINet 用户代理并清除 ProxyServer / ProxyOverride / AutoConfigURL。',
    scope: 'windows.wininet',
    risk: 'low',
    requiresAdmin: false,
    requiresReboot: false,
    recoverable: true,
    kind: 'configure',
    request: { scope: 'windows.wininet', action: 'clear' },
  },
  {
    id: 'wsl-autoproxy-enable',
    platform: 'windows',
    label: '启用 WSL autoProxy',
    description: '只修改 Windows 侧 .wslconfig 的 autoProxy=true；需要重启 WSL 后生效。',
    scope: 'windows.wslconfig',
    risk: 'medium',
    requiresAdmin: false,
    requiresReboot: true,
    recoverable: true,
    kind: 'configure',
    request: { scope: 'windows.wslconfig', action: 'set', patch: { autoProxy: true } },
  },
  {
    id: 'clear-winhttp-user-proxy',
    platform: 'windows',
    label: '清除 WinHTTP 用户高级代理',
    description: '只清除当前用户的 WinHTTP 高级代理，不修改机器级 WinHTTP。',
    scope: 'windows.winhttp.user',
    risk: 'low',
    requiresAdmin: false,
    requiresReboot: false,
    recoverable: true,
    kind: 'configure',
    request: { scope: 'windows.winhttp.user', action: 'clear' },
  },
]

const ADVANCED_OPERATIONS: RepairOperation[] = [
  {
    id: 'reset-winhttp-machine-proxy',
    platform: 'windows',
    label: '重置 WinHTTP 机器代理为直连',
    description: '执行 netsh winhttp reset proxy；执行前创建机器级 WinHTTP 快照。',
    scope: 'windows.winhttp.machine',
    risk: 'medium',
    requiresAdmin: true,
    requiresReboot: false,
    recoverable: true,
    kind: 'advanced',
    advancedId: 'reset-winhttp-proxy',
  },
  {
    id: 'flush-dns',
    label: '刷新 DNS 解析缓存',
    description: '执行 ipconfig /flushdns，清除 Windows DNS 客户端缓存。',
    scope: 'windows.dns.cache',
    risk: 'low',
    requiresAdmin: false,
    requiresReboot: false,
    recoverable: true,
    kind: 'advanced',
    advancedId: 'flush-dns',
  },
  {
    id: 'reset-winsock',
    platform: 'windows',
    label: '重置 Winsock 目录',
    description: '执行 netsh winsock reset；高风险，执行后需要重启。',
    scope: 'windows.winsock',
    risk: 'high',
    requiresAdmin: true,
    requiresReboot: true,
    recoverable: false,
    kind: 'advanced',
    advancedId: 'reset-winsock',
  },
  {
    id: 'reset-ip',
    platform: 'windows',
    label: '重置 TCP/IP 协议栈',
    description: '执行 netsh int ip reset；高风险，执行后需要重启。',
    scope: 'windows.tcpip',
    risk: 'high',
    requiresAdmin: true,
    requiresReboot: true,
    recoverable: false,
    kind: 'advanced',
    advancedId: 'reset-ip',
  },
]


const MACOS_OPERATIONS: RepairOperation[] = [
  {
    id: 'mac-flush-dns',
    label: '刷新 macOS DNS 缓存',
    description: '执行 dscacheutil -flushcache 和 killall -HUP mDNSResponder，刷新 macOS DNS 解析缓存。',
    scope: 'macos.dns.cache',
    risk: 'low',
    requiresAdmin: false,
    requiresReboot: false,
    recoverable: true,
    kind: 'advanced',
    advancedId: 'mac-flush-dns',
  },
  {
    id: 'mac-clear-scutil-proxy',
    label: '关闭 macOS 系统代理（scutil）',
    description: '通过网络设置关闭 HTTP/HTTPS/SOCKS 系统代理；清除代理软件退出后的 scutil 残余。',
    scope: 'macos.scutil',
    risk: 'low',
    requiresAdmin: false,
    requiresReboot: false,
    recoverable: true,
    kind: 'configure',
    request: { scope: 'macos.scutil' as never, action: 'clear' as never },
  },
]

export const REPAIR_OPERATIONS: readonly RepairOperation[] = [
  ...CONFIGURE_OPERATIONS,
  ...ADVANCED_OPERATIONS,
  ...MACOS_OPERATIONS,
]

export function repairCatalog(): RepairOperation[] {
  return REPAIR_OPERATIONS.map(operation => ({ ...operation }))
}

export function findRepairOperation(id: string): RepairOperation | undefined {
  return REPAIR_OPERATIONS.find(operation => operation.id === id)
}

/**
 * Recommendation policy: only common, high-reliability operations are ever
 * surfaced as "recommended". They must be low-risk and match problems seen
 * repeatedly in the field (proxy-software residue, stale DNS cache). Admin /
 * reboot / non-recoverable operations stay in the manual catalog below.
 */
const RECOMMENDABLE_OPERATION_IDS: ReadonlySet<string> = new Set([
  'flush-dns',
  'mac-flush-dns',
  'clear-user-env-proxy',
  'clear-wininet-user-proxy',
  'clear-winhttp-user-proxy',
  'clear-dsh-process-proxy',
])

/** Diagnoses below this confidence never drive a recommended button. */
export const RECOMMEND_CONFIDENCE_THRESHOLD = 0.85

export function isRecommendableOperation(id: string): boolean {
  return RECOMMENDABLE_OPERATION_IDS.has(id)
}

/** Filter operations by the runtime platform; undefined platform means universal. */
export function operationsForPlatform(platform: NodeJS.Platform | undefined): RepairOperation[] {
  const os = platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : undefined
  return REPAIR_OPERATIONS.filter(op => op.platform === undefined || op.platform === os)
}

/** Map a Phase 2 diagnosis action to one or more independent repair operations. */
export function diagnosisActionOperations(action: DiagnosisAction): RepairOperation[] {
  const direct = findRepairOperation(action.code)
  if (direct !== undefined) return [direct]

  switch (action.code) {
    case 'PROXY_ENDPOINT_UNREACHABLE':
    case 'PROXY_CONFIGURED_BUT_UNUSABLE':
    case 'repair-proxy-endpoint':
    case 'repair-proxy-usability': {
      // Suggest exactly the operation that touches the endpoint's own scope.
      // A blanket "clear every proxy scope" list misled users into removing
      // unrelated (and often healthy) proxy configuration.
      const operation = proxyScopeOperation(action.scope)
      return operation === undefined ? [] : [operation]
    }
    case 'STALE_DSH_PROXY_ENV':
      return [findRepairOperation('clear-dsh-process-proxy')].filter((operation): operation is RepairOperation => operation !== undefined)
    case 'ENV_SCOPE_CONFLICT':
      // User-scope residue is the common proxy-software leftover. Machine-scope
      // conflicts are rare and clearing them triggers UAC, so they stay manual.
      return [findRepairOperation('clear-user-env-proxy')].filter((operation): operation is RepairOperation => operation !== undefined)
    case 'DNS_FAILURE':
    case 'repair-dns':
      return [findRepairOperation('flush-dns')].filter((operation): operation is RepairOperation => operation !== undefined)
    case 'TLS_FAILURE':
      return []
    case 'WSL_AUTOPROXY_STALE':
    case 'WSL_PROXY_UNREACHABLE':
    case 'WSL_PROXY_LOOPBACK_UNREACHABLE':
      return [
        findRepairOperation('clear-wininet-user-proxy'),
        findRepairOperation('clear-winhttp-user-proxy'),
      ].filter((operation): operation is RepairOperation => operation !== undefined)
    case 'HOSTS_OVERRIDE':
      return []
    default:
      return []
  }
}

function proxyScopeOperation(scope: string): RepairOperation | undefined {
  switch (scope) {
    case 'wininet.user':
      return findRepairOperation('clear-wininet-user-proxy')
    case 'winhttp.user':
      return findRepairOperation('clear-winhttp-user-proxy')
    case 'winhttp.machine':
      return findRepairOperation('reset-winhttp-machine-proxy')
    case 'env.process':
    case 'dsh.process':
      return findRepairOperation('clear-dsh-process-proxy')
    case 'env.user':
    case 'windows.env.user':
      return findRepairOperation('clear-user-env-proxy')
    case 'env.machine':
    case 'windows.env.machine':
      return findRepairOperation('clear-machine-env-proxy')
    default:
      return undefined
  }
}
