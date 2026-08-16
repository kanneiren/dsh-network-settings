/** Windows PowerShell runner with a fixed UTF-8/JSON output contract. */
import { runCommand, type RunCommandOptions } from './command.ts'

const PREAMBLE = [
  '$ProgressPreference = "SilentlyContinue"',
  '$ErrorActionPreference = "Stop"',
  'try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}',
].join('; ')

export interface PowerShellResult {
  stdout: string
  stderr: string
  code: number | null
  timedOut: boolean
  aborted: boolean
  durationMs: number
}

/** Run a PowerShell script block read-only and return decoded UTF-8 streams. */
export async function runPowerShell(
  script: string,
  options: Omit<RunCommandOptions, 'encoding'> & { pwsh?: boolean } = {},
): Promise<PowerShellResult> {
  const file = options.pwsh === true ? 'pwsh.exe' : 'powershell.exe'
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `${PREAMBLE}; ${script}`]
  return runCommand(file, args, { ...options, encoding: 'utf8' })
}
