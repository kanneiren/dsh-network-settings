/** WSL proxy source attribution: find which file:line carries proxy variables. */
import { runWslScript } from '../probe/wsl.ts'
import { redactProxyUrl } from '../redact.ts'

export interface WslProxySource {
  id: string
  distribution: string
  file: string
  line: number
  raw: string
  value: string
  scope: `wsl.${string}`
}

const SEARCH_PATHS = [
  '"$HOME/.bashrc"',
  '"$HOME/.bash_profile"',
  '"$HOME/.profile"',
  '"$HOME/.zshrc"',
  '"$HOME/.zprofile"',
  '"$HOME/.config/fish/config.fish"',
  '/etc/environment',
  '/etc/profile',
  '/etc/profile.d/*.sh',
  '"$HOME"/.config/environment.d/*.conf',
]

const SCRIPT = String.raw`
for file in ${SEARCH_PATHS.join(' ')}; do
  if [ -f "$file" ]; then
    grep -HnE '^(export[[:space:]]+)?(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy)=' "$file" 2>/dev/null || true
  fi
done
`

function safeId(distribution: string, file: string, line: number): string {
  const encoded = Buffer.from(`${distribution}|${file}|${line}`).toString('base64url')
  return encoded
}

export function parseProxySources(distribution: string, output: string): WslProxySource[] {
  const sources: WslProxySource[] = []
  for (const raw of output.replaceAll('\r\n', '\n').split('\n')) {
    const match = /^([^:]+):([0-9]+):(.*)$/.exec(raw)
    if (match === null) continue
    const file = match[1] ?? ''
    const line = Number(match[2] ?? 0)
    const value = (match[3] ?? '').trim()
    if (!Number.isInteger(line) || value === '') continue
    sources.push({
      id: safeId(distribution, file, line),
      distribution,
      file,
      line,
      raw: redactProxyUrl(value),
      value,
      scope: `wsl.${distribution}`,
    })
  }
  return sources
}

export async function inspectWslProxySources(
  distribution: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<WslProxySource[]> {
  const result = await runWslScript(distribution, SCRIPT, options)
  if (result.code !== 0) return []
  return parseProxySources(distribution, result.stdout)
}
