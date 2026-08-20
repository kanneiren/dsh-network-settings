/** Manual Phase 1 smoke: print the read-only inspection as JSON. */
import { inspectNetwork } from './inspect.ts'
import { windowsOf } from './model.ts'
import { runDiagnosis } from './diagnose/rules.ts'

const includeWsl = process.argv.includes('--no-wsl') ? false : true
const includeProbes = process.argv.includes('--no-probes') ? false : true
const diagnoseOnly = process.argv.includes('--diagnose-only') ? true : false
const inspection = await inspectNetwork({ includeWsl, includeProbes, timeoutMs: 30_000 })
if (diagnoseOnly) {
  const report = runDiagnosis({
    dsh: inspection.dsh,
    ...inspection.windows === undefined ? {} : { windows: inspection.windows },
    ...inspection.macos === undefined ? {} : { macos: inspection.macos },
    ...inspection.wsl === undefined ? {} : { wsl: inspection.wsl },
    probes: inspection.probes,
    endpoints: windowsOf(inspection).proxy.endpoints,
  })
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(JSON.stringify(inspection, null, 2))
}
