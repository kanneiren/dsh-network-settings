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
  const result = await runCommand(file, args, { ...options, encoding: 'utf8' })
  // From a WSL-side host, powershell.exe only resolves through Windows
  // interop; a raw ENOENT there means interop is disabled, and surfacing
  // "spawn powershell.exe ENOENT" would not tell the user anything actionable.
  if (process.platform !== 'win32' && result.stderr.includes('spawn error:')) {
    return {
      ...result,
      stderr: '无法从 WSL 调用 powershell.exe：Windows interop 可能已禁用（检查 /etc/wsl.conf 的 [interop] enabled 设置）。此操作需要在 Windows 侧执行，或启用 interop 后重试。',
    }
  }
  return result
}
