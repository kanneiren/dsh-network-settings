/** Minimal line-preserving `.wslconfig` autoProxy editor. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { wslconfigPaths } from '../wsl/inspect.ts'
import { parseWslGlobalConfig } from '../wsl/wslconfig.ts'
import type { WslNetworkConfig } from '../model.ts'
import { homedir } from 'node:os'

function wslconfigPath(): string {
  const path = wslconfigPaths().find(candidate => {
    try {
      void candidate
      return true
    } catch {
      return false
    }
  })
  if (path !== undefined) return path
  return join(homedir(), '.wslconfig')
}

export async function readWslAutoProxyConfig(): Promise<WslNetworkConfig> {
  const path = wslconfigPath()
  try {
    return parseWslGlobalConfig(await readFile(path, 'utf8'))
  } catch {
    return parseWslGlobalConfig('')
  }
}

export function setWslAutoProxyInText(text: string, enabled: boolean): string {
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  const keyIndex = lines.findIndex(line => /^\s*autoProxy\s*=/.test(line))
  if (keyIndex >= 0) {
    lines[keyIndex] = `autoProxy=${String(enabled)}`
  } else {
    const wsl2Index = lines.findIndex(line => /^\s*\[wsl2\]\s*$/.test(line))
    if (wsl2Index >= 0) {
      lines.splice(wsl2Index + 1, 0, `autoProxy=${String(enabled)}`)
    } else {
      lines.push('', '[wsl2]', `autoProxy=${String(enabled)}`)
    }
  }
  return lines.join('\n')
}

export async function setWslAutoProxy(enabled: boolean): Promise<WslNetworkConfig> {
  const path = wslconfigPath()
  let text = ''
  try {
    text = await readFile(path, 'utf8')
  } catch {
    text = ''
  }
  const next = setWslAutoProxyInText(text, enabled)
  await writeFile(path, next, 'utf8')
  return parseWslGlobalConfig(next)
}
