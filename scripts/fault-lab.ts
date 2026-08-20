/**
 * Proxy-fault scenario lab for dsh-network-settings.
 *
 * Run:  node --experimental-strip-types scripts/fault-lab.ts [scenarioId...]
 *
 * Interruption safety by construction: every fault is injected via this
 * process's own environment variables — nothing is written to the registry,
 * user env, or any file. Killing the run at any point leaves the machine
 * untouched; simply re-run. Results are appended to
 * .research/fault-lab-report.json (gitignored).
 *
 * The script IS the DSH host for the duration of a run: inspectNetwork reads
 * this process's env as the DSH process environment, and the PowerShell child
 * inherits it, so injected proxy vars appear in the env.process scope exactly
 * as they would in a real DSH instance launched with them.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { inspectNetwork } from '../src/host/inspect.ts'
import { buildNetworkReport } from '../src/host/network/index.ts'
import { runDiagnosis } from '../src/host/diagnose/rules.ts'
import { RECOMMEND_CONFIDENCE_THRESHOLD, diagnosisActionOperations, isRecommendableOperation } from '../src/host/repair/catalog.ts'

const TARGET = { id: 'deepseek', label: 'DeepSeek', host: 'api.deepseek.com', port: 443, url: 'https://api.deepseek.com', kind: 'deepseek' } as const
const REPORT_FILE = new URL('../.research/fault-lab-report.json', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

interface CheckResult {
  codes: Set<string>
  egressMode: 'DIRECT' | 'PROXY' | undefined
  endpointSummary: string[]
  chain: string
  /** Action codes of the graph-level recommended repair hint (gated). */
  graphRecommended: string[]
  /** Whitelisted operations the repair/recommended RPC would return. */
  rpcRecommendedOps: string[]
}

async function runCheck(): Promise<CheckResult> {
  const inspection = await inspectNetwork({ timeoutMs: 45_000, includeWsl: false, targets: [TARGET] })
  const report = buildNetworkReport({ inspection, targetId: TARGET.id })
  const graph = report.graph
  const egress = graph?.dshPath.egress
  const dshEgress = egress?.mode === 'PROXY'
    ? {
        host: egress.proxyEndpoint?.host ?? egress.proxyConfiguration?.host ?? '',
        port: egress.proxyEndpoint?.port ?? egress.proxyConfiguration?.port ?? 0,
      }
    : egress?.mode === 'DIRECT' ? null : undefined
  const diagnosis = runDiagnosis({
    dsh: inspection.dsh,
    ...inspection.windows === undefined ? {} : { windows: inspection.windows },
    ...inspection.macos === undefined ? {} : { macos: inspection.macos },
    probes: inspection.probes,
    endpoints: inspection.windows !== undefined ? inspection.windows.proxy.endpoints : inspection.macos !== undefined ? inspection.macos.proxy.endpoints : [],
    ...(dshEgress === undefined ? {} : { dshEgress }),
  })
  const codes = new Set<string>([
    ...(graph?.diagnostics ?? []).map(item => item.code),
    ...diagnosis.diagnoses.map(item => item.code),
  ])
  // Same gating as the repair/recommended RPC: diagnoses with confidence
  // >= threshold, actions mapped to whitelisted common operations.
  const rpcRecommendedOps = [...(graph?.diagnostics ?? []), ...diagnosis.diagnoses]
    .filter(item => item.confidence >= RECOMMEND_CONFIDENCE_THRESHOLD)
    .flatMap(item => item.actions.flatMap(action => diagnosisActionOperations(action)))
    .filter(operation => isRecommendableOperation(operation.id))
    .map(operation => operation.id)
  return {
    codes,
    egressMode: egress?.mode,
    endpointSummary: (inspection.windows ?? inspection.macos ?? { proxy: { endpoints: [] } }).proxy.endpoints.map(e =>
      `${e.source}=${e.host}:${e.port}${e.listener?.state === 'LISTENING' ? ' listener:' + (e.listener.processName ?? '?') : e.listener?.state === 'NOT_FOUND' ? ' listener:NOT_FOUND' : ''}`),
    chain: (graph?.dshPath.nodes ?? []).map(n => n.label).join(' → '),
    graphRecommended: graph?.recommendedRepair?.actionCodes ?? [],
    rpcRecommendedOps: [...new Set(rpcRecommendedOps)],
  }
}

interface Scenario {
  id: string
  name: string
  env: Record<string, string>
  expect: (r: CheckResult) => boolean
  /** Expected operations the recommended-repair UI should surface, if any. */
  expectRepair: string[]
  describe: (r: CheckResult) => string
}

const has = (r: CheckResult, code: string): boolean => r.codes.has(code)

const SCENARIOS: Scenario[] = [
  {
    id: 'S1',
    name: 'DSH env residue → dead proxy port (the classic "closed the proxy, no internet")',
    env: { HTTPS_PROXY: 'http://127.0.0.1:7899' },
    expect: r => r.egressMode === 'PROXY' && has(r, 'PROXY_ENDPOINT_UNREACHABLE') && (has(r, 'DRIFT_DSH_PROXY_STALE') || has(r, 'STALE_DSH_PROXY_ENV')),
    expectRepair: ['clear-dsh-process-proxy'],
    describe: r => `egress=${r.egressMode} codes=[${[...r.codes].join(', ')}] repair=[${r.rpcRecommendedOps.join(', ')}]`,
  },
  {
    id: 'S4',
    name: 'Proxy healthy in WinINet but DSH has no env → DSH egresses DIRECT (no false alarm)',
    env: {},
    expect: r => r.egressMode === 'DIRECT' && !has(r, 'PROXY_ENDPOINT_UNREACHABLE'),
    expectRepair: [],
    describe: r => `egress=${r.egressMode} endpoints=[${r.endpointSummary.join(' | ')}] repair=[${r.rpcRecommendedOps.join(', ')}]`,
  },
  {
    id: 'S5',
    name: 'NO_PROXY bypass → proxy configured but traffic silently goes direct',
    env: { HTTPS_PROXY: 'http://127.0.0.1:7892', NO_PROXY: 'api.deepseek.com' },
    expect: r => r.egressMode === 'DIRECT' && !has(r, 'PROXY_ENDPOINT_UNREACHABLE'),
    expectRepair: [],
    describe: r => `egress=${r.egressMode} codes=[${[...r.codes].join(', ')}] repair=[${r.rpcRecommendedOps.join(', ')}]`,
  },
  {
    id: 'S6',
    name: 'Port drift → DSH env points at old port, live proxy elsewhere',
    env: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
    expect: r => r.egressMode === 'PROXY' && has(r, 'PROXY_ENDPOINT_UNREACHABLE'),
    expectRepair: ['clear-dsh-process-proxy'],
    describe: r => `egress=${r.egressMode} endpoints=[${r.endpointSummary.join(' | ')}] repair=[${r.rpcRecommendedOps.join(', ')}]`,
  },
]

async function runScenario(scenario: Scenario): Promise<{ id: string; name: string; pass: boolean; detail: string; chain: string }> {
  const saved: Record<string, string | undefined> = {}
  for (const key of Object.keys(scenario.env)) {
    saved[key] = process.env[key]
    process.env[key] = scenario.env[key]
  }
  try {
    const result = await runCheck()
    const pass = scenario.expect(result)
    const repairPass = scenario.expectRepair.length === 0
      ? result.rpcRecommendedOps.length === 0
      : scenario.expectRepair.every(op => result.rpcRecommendedOps.includes(op)) && result.rpcRecommendedOps.length === scenario.expectRepair.length
    return { id: scenario.id, name: scenario.name, pass: pass && repairPass, detail: `${scenario.describe(result)} | repair-expected=[${scenario.expectRepair.join(', ')}] repair-pass=${repairPass}`, chain: result.chain }
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

const requested = process.argv.slice(2)
const selected = SCENARIOS.filter(s => requested.length === 0 || requested.includes(s.id))
if (selected.length === 0) {
  console.error(`unknown scenario(s): ${requested.join(', ')}; available: ${SCENARIOS.map(s => s.id).join(', ')}`)
  process.exit(2)
}

console.log(`fault-lab: ${selected.length} scenario(s), all injections are in-process env vars (interruptible at any time)\n`)
const results = []
for (const scenario of selected) {
  process.stdout.write(`${scenario.id} ${scenario.name} ... `)
  const outcome = await runScenario(scenario)
  console.log(outcome.pass ? 'PASS' : 'FAIL')
  console.log(`   ${outcome.detail}`)
  results.push({ ...outcome, timestamp: new Date().toISOString() })
}

const history = existsSync(REPORT_FILE) ? JSON.parse(readFileSync(REPORT_FILE, 'utf8')) as unknown[] : []
writeFileSync(REPORT_FILE, JSON.stringify([...history, { run: new Date().toISOString(), results }], null, 2))
const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed; report appended to .research/fault-lab-report.json`)
process.exit(failed.length === 0 ? 0 : 1)
