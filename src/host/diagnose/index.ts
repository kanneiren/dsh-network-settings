/** Run read-only inspection, then deterministic diagnosis. */
import { inspectNetwork, type InspectNetworkOptions } from '../inspect.ts'
import { runDiagnosis, type DiagnosisReport } from './rules.ts'

export interface NetworkDiagnosisOptions extends InspectNetworkOptions {}

export async function diagnoseNetwork(options: NetworkDiagnosisOptions = {}): Promise<DiagnosisReport> {
  const inspection = await inspectNetwork(options)
  return runDiagnosis({
    windows: inspection.windows,
    ...inspection.wsl === undefined ? {} : { wsl: inspection.wsl },
    probes: inspection.probes,
    endpoints: inspection.windows.proxy.endpoints,
  })
}
