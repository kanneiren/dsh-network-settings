/** Read-only subprocess runner with timeout, cancellation and output caps. * Module facade: Public surface: runCommand(), extractJson(). argv-array subprocess runner with timeout/abort/output caps.
 */
import { spawn } from 'node:child_process'

export interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  durationMs: number
}

export interface RunCommandOptions {
  timeoutMs?: number
  signal?: AbortSignal
  maxStdoutBytes?: number
  maxStderrBytes?: number
  encoding?: BufferEncoding
  /** Optional stdin payload (avoids shell argument quoting entirely). */
  input?: string
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_BYTES = 512 * 1024

/**
 * Spawn a read-only platform command. Never passes a shell; arguments are
 * passed as an argv array so distribution names and URLs cannot inject.
 */
export function runCommand(
  file: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const started = performance.now()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_MAX_BYTES
  const maxStderrBytes = options.maxStderrBytes ?? DEFAULT_MAX_BYTES
  const encoding = options.encoding ?? 'utf8'

  return new Promise((resolve) => {
    const child = spawn(file, [...args], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let aborted = false

    const settle = (partial: Partial<CommandResult>): void => {
      if (settled) return
      settled = true
      resolve({
        code: partial.code ?? child.exitCode,
        stdout,
        stderr,
        timedOut,
        aborted,
        durationMs: Math.round(performance.now() - started),
      })
    }

    const kill = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) return
      try {
        child.kill('SIGTERM')
      } catch {
        // The process may already be gone.
      }
      const force = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // Already reaped.
        }
      }, 1500)
      force.unref?.()
    }

    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, timeoutMs)
    timer.unref?.()

    const onAbort = (): void => {
      aborted = true
      clearTimeout(timer)
      kill()
    }
    const signal = options.signal
    if (signal !== undefined) {
      if (signal.aborted) {
        onAbort()
      } else {
        signal.addEventListener('abort', onAbort, { once: true })
      }
    }

    if (options.input !== undefined) {
      child.stdin.end(options.input)
    } else {
      child.stdin.end()
    }
    child.stdin.on('error', () => {
      // The child may exit before reading stdin; this is not a command error.
    })

    child.stdout.on('data', (chunk: Buffer) => {
      if (Buffer.byteLength(stdout) < maxStdoutBytes) stdout += chunk.toString(encoding)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (Buffer.byteLength(stderr) < maxStderrBytes) stderr += chunk.toString(encoding)
    })
    child.on('error', (error) => {
      stderr += `spawn error: ${error.message}`
      settle({ code: null })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (signal !== undefined) signal.removeEventListener('abort', onAbort)
      settle({ code })
    })
  })
}

/** Extract the first JSON object/array from text that may contain preamble noise. */
export function extractJson<T = unknown>(text: string): T {
  const startObject = text.indexOf('{')
  const startArray = text.indexOf('[')
  let start = -1
  let end = -1
  if (startObject >= 0 && (startArray < 0 || startObject < startArray)) {
    start = startObject
    end = text.lastIndexOf('}')
  } else {
    start = startArray
    end = text.lastIndexOf(']')
  }
  if (start < 0 || end < 0 || end <= start) throw new Error(`no JSON value found in command output: ${text.slice(0, 200)}`)
  return JSON.parse(text.slice(start, end + 1)) as T
}

