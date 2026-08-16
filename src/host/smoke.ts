/** Manual Phase 1 smoke: print the read-only inspection as JSON. */
import { inspectNetwork } from './inspect.ts'
import { runDiagnosis } from './diagnose/rules.ts'

const includeWsl = process.argv.includes('--no-wsl') ? false : true
const includeProbes = process.argv.includes('--no-probes') ? false : true
const diagnoseOnly = process.argv.includes('--diagnose-only') ? true : false
const inspection = await inspectNetwork({ includeWsl, includeProbes, timeoutMs: 30_000 })
if (diagnoseOnly) {
  const report = runDiagnosis({
    windows: inspection.windows,
    ...inspection.wsl === undefined ? {} : { wsl: inspection.wsl },
    probes: inspection.probes,
    endpoints: inspection.windows.proxy.endpoints,
  })
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(JSON.stringify(inspection, null, 2))
}
