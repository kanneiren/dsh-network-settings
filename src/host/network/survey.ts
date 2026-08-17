/** Read-only survey consumed by graph builders. */
import type { NetworkInspection } from '../model.ts'
import type { DetectedRuntime, NetworkTarget, UnsupportedRuntime } from './types.ts'

export interface GraphSurvey {
  runtime: Exclude<DetectedRuntime, UnsupportedRuntime>
  inspection: NetworkInspection
  target: NetworkTarget
}
